import { Injectable } from '@nestjs/common';

import type { ServiceSalesRules } from '../../domain/sales-rules';
import { DatabaseService } from '@database';
import {
  newId,
  NotFoundError,
  requireTenantId,
  type LocalDate,
  type RouteId,
  type SeatLayoutId,
  type ServiceId,
  type StopId,
  type TripId,
  type VehicleId,
} from '@kernel';

export type TripStatus = 'scheduled' | 'open' | 'departed' | 'closed' | 'cancelled';

export interface TripRecord {
  id: TripId;
  serviceId: ServiceId;
  routeId: RouteId;
  vehicleId: VehicleId | null;
  seatLayoutId: SeatLayoutId;
  journeyDate: LocalDate;
  departsAt: Date;
  arrivesAt: Date;
  stopCount: number;
  totalSeats: number;
  status: TripStatus;
}

export interface TripStopRow {
  sequence: number;
  stopId: StopId;
  arrivesAt: Date;
  departsAt: Date;
  canBoard: boolean;
  canAlight: boolean;
}

export interface SeatInit {
  seatNumber: string;
  seatType: string;
  isBookable: boolean;
  ladiesOnly: boolean;
  /** Disability-friendly seat (#141). */
  accessible?: boolean;
}

/**
 * Trip persistence + the atomic "materialise one trip" write.
 *
 * `insertTrip` writes the trip, its snapshotted stops, and its per-seat
 * inventory rows in one call (the caller wraps it in a unit of work). Stops are
 * SNAPSHOTTED from the route at this moment so a later route edit cannot alter
 * a trip that already has tickets sold against it.
 */
@Injectable()
export class TripRepository {
  constructor(private readonly db: DatabaseService) {}

  async insertTrip(input: {
    serviceId: ServiceId;
    routeId: RouteId;
    vehicleId: VehicleId | null;
    seatLayoutId: SeatLayoutId;
    journeyDate: LocalDate;
    departsAt: Date;
    arrivesAt: Date;
    stopCount: number;
    stops: TripStopRow[];
    seats: SeatInit[];
    extra?: { isExtra: true; reason: string; ladiesSpecial: boolean; closedChannels: string[] };
  }): Promise<TripId> {
    const tenantId = requireTenantId();
    const tripId = newId() as TripId;

    await this.db.execute_(
      `INSERT INTO trips (id, tenant_id, service_id, route_id, vehicle_id, seat_layout_id,
                          journey_date, departs_at, arrives_at, stop_count, total_seats, status,
                          is_extra, extra_reason, ladies_special, closed_channels)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12,$13,$14,$15::text[])`,
      [
        tripId,
        tenantId,
        input.serviceId,
        input.routeId,
        input.vehicleId,
        input.seatLayoutId,
        input.journeyDate,
        input.departsAt,
        input.arrivesAt,
        input.stopCount,
        input.seats.length,
        input.extra?.isExtra ?? false,
        input.extra?.reason ?? null,
        input.extra?.ladiesSpecial ?? false,
        input.extra?.closedChannels ?? [],
      ],
      { name: 'trip.insert', primary: true },
    );

    // Snapshot stops.
    const stopParams: unknown[] = [];
    const stopSql = input.stops.map((s, i) => {
      const b = i * 8;
      stopParams.push(
        tripId,
        tenantId,
        s.sequence,
        s.stopId,
        s.arrivesAt,
        s.departsAt,
        s.canBoard,
        s.canAlight,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    await this.db.execute_(
      `INSERT INTO trip_stops (trip_id, tenant_id, sequence, stop_id, arrives_at, departs_at, can_board, can_alight)
       VALUES ${stopSql.join(',')}`,
      stopParams,
      { name: 'trip.insertStops', primary: true },
    );

    // Initialise seat inventory (occupied_legs = 0).
    const seatParams: unknown[] = [];
    const seatSql = input.seats.map((s, i) => {
      const b = i * 7;
      seatParams.push(
        tripId,
        tenantId,
        s.seatNumber,
        s.seatType,
        s.isBookable,
        s.ladiesOnly,
        s.accessible === true,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    });
    await this.db.execute_(
      `INSERT INTO trip_seats (trip_id, tenant_id, seat_number, seat_type, is_bookable, ladies_only, accessible)
       VALUES ${seatSql.join(',')}`,
      seatParams,
      { name: 'trip.insertSeats', primary: true },
    );

    return tripId;
  }

  /** Trips of the route (not cancelled) departing within ±minutes of an instant — timetable overlap guard. */
  async tripsNear(routeId: RouteId, departsAt: Date, minutes: number): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM trips WHERE tenant_id = $1 AND route_id = $2 AND status <> 'cancelled'
          AND departs_at BETWEEN $3::timestamptz - make_interval(mins => $4) AND $3::timestamptz + make_interval(mins => $4)`,
      [requireTenantId(), routeId, departsAt, minutes],
      { name: 'trip.near', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  /** Is this bus already running a trip that overlaps [departsAt, departsAt+durationMin] (30-min turnaround either side)? */
  async vehicleBusyAround(
    vehicleId: VehicleId,
    departsAt: Date,
    durationMin: number,
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM trips WHERE tenant_id = $1 AND vehicle_id = $2 AND status IN ('scheduled', 'open', 'departed')
          AND departs_at - interval '30 minutes' < $3::timestamptz + make_interval(mins => $4)
          AND arrives_at + interval '30 minutes' > $3::timestamptz`,
      [requireTenantId(), vehicleId, departsAt, Math.max(1, durationMin)],
      { name: 'trip.vehicleBusy', primary: true },
    );
    return Number(row?.n ?? 0) > 0;
  }

  /** Demand signal for extra trips: next 7 days, ≥ 80% sold or anyone waiting. */
  async extraTripCandidates(): Promise<unknown[]> {
    return this.db.query(
      `SELECT t.id AS "tripId", t.journey_date AS "journeyDate", t.departs_at AS "departsAt", r.name AS "routeName", t.service_id AS "serviceId",
              t.total_seats AS "totalSeats",
              (SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id WHERE bs.trip_id = t.id AND b.status IN ('confirmed','completed'))::int AS "sold",
              (SELECT coalesce(sum(seat_count), 0) FROM trip_waitlist w WHERE w.trip_id = t.id AND w.status = 'waiting')::int AS "waitingSeats"
         FROM trips t JOIN routes r ON r.id = t.route_id
        WHERE t.tenant_id = $1 AND t.status IN ('scheduled','open') AND t.departs_at BETWEEN now() AND now() + interval '7 days'
          AND ((SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id WHERE bs.trip_id = t.id AND b.status IN ('confirmed','completed')) >= 0.8 * t.total_seats
               OR EXISTS (SELECT 1 FROM trip_waitlist w WHERE w.trip_id = t.id AND w.status = 'waiting'))
        ORDER BY t.departs_at LIMIT 100`,
      [requireTenantId()],
      { name: 'trip.extraCandidates' },
    );
  }

  /** Expire every live checkout hold on a trip at once (259). Phone holds are kept unless included. */
  async releaseHolds(tripId: TripId, includePhoneHolds: boolean): Promise<number> {
    return this.db.execute_(
      `UPDATE bookings SET hold_expires_at = now() - interval '1 second', updated_at = now()
        WHERE tenant_id = $1 AND trip_id = $2 AND status = 'held' AND hold_expires_at > now() AND ($3 OR channel <> 'phone')`,
      [requireTenantId(), tripId, includePhoneHolds],
      { name: 'trip.releaseHolds', primary: true },
    );
  }

  async addRemark(tripId: TripId, remark: string, by: string | null): Promise<void> {
    await this.db.execute_(
      `INSERT INTO trip_remarks (tenant_id, trip_id, remark, created_by) VALUES ($1,$2,$3,$4)`,
      [requireTenantId(), tripId, remark, by],
      { name: 'trip.addRemark', primary: true },
    );
  }

  async remarks(tripId: TripId): Promise<unknown[]> {
    return this.db.query(
      `SELECT r.id, r.remark, r.created_at AS "createdAt", u.full_name AS "by" FROM trip_remarks r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.tenant_id = $1 AND r.trip_id = $2 ORDER BY r.created_at DESC`,
      [requireTenantId(), tripId],
      { name: 'trip.remarks' },
    );
  }

  /** Release an extra trip's inventory to every channel (it is created closed). */
  async openAllChannels(tripId: TripId): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE trips SET closed_channels = '{}', updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status IN ('scheduled', 'open')`,
      [requireTenantId(), tripId],
      { name: 'trip.openAllChannels', primary: true },
    );
    return n > 0;
  }

  /** The name of the trip's service (DEL-PAT-1500); null for a one-off trip. */
  async serviceCode(tripId: TripId): Promise<string | null> {
    const row = await this.db.queryOne<{ code: string | null }>(
      `SELECT s.code FROM trips t LEFT JOIN services s ON s.id = t.service_id
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), tripId],
      { name: 'trip.serviceCode' },
    );
    return row?.code ?? null;
  }

  /** Closed channels split by where they were closed: this trip, or its whole service. */
  async channelState(
    tripId: TripId,
  ): Promise<{ closedOnTrip: string[]; closedByService: string[] }> {
    const row = await this.db.queryOne<{ own: string[] | null; svc: string[] | null }>(
      `SELECT t.closed_channels AS own, s.closed_channels AS svc
         FROM trips t LEFT JOIN services s ON s.id = t.service_id WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), tripId],
      { name: 'trip.channelState' },
    );
    return { closedOnTrip: row?.own ?? [], closedByService: row?.svc ?? [] };
  }

  /** Channels whose sales are closed for this trip (its own list ∪ its service's list). */
  async closedChannels(tripId: TripId): Promise<string[]> {
    const row = await this.db.queryOne<{ closed: string[] | null }>(
      `SELECT array(SELECT DISTINCT unnest(t.closed_channels || coalesce(s.closed_channels, '{}'))) AS closed
         FROM trips t LEFT JOIN services s ON s.id = t.service_id WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), tripId],
      { name: 'trip.closedChannels' },
    );
    return row?.closed ?? [];
  }

  /**
   * Move a trip (every stop time with it) by `minutes` (#275). Only a trip
   * that has not left; returns the old and new departure, or null.
   */
  async shiftTimes(
    tripId: TripId,
    minutes: number,
  ): Promise<{ oldDepartsAt: Date; newDepartsAt: Date } | null> {
    const row = await this.db.queryOne<{ old_departs_at: Date; new_departs_at: Date }>(
      `UPDATE trips t SET departs_at = t.departs_at + make_interval(mins => $3),
              arrives_at = t.arrives_at + make_interval(mins => $3), version = t.version + 1, updated_at = now()
         FROM (SELECT departs_at AS old_departs_at FROM trips WHERE id = $2) o
        WHERE t.tenant_id = $1 AND t.id = $2 AND t.status IN ('scheduled', 'open') AND t.actual_departed_at IS NULL
        RETURNING o.old_departs_at, t.departs_at AS new_departs_at`,
      [requireTenantId(), tripId, minutes],
      { name: 'trip.shiftTimes', primary: true },
    );
    if (!row) return null;
    await this.db.execute_(
      `UPDATE trip_stops SET arrives_at = arrives_at + make_interval(mins => $3),
              departs_at = departs_at + make_interval(mins => $3)
        WHERE tenant_id = $1 AND trip_id = $2`,
      [requireTenantId(), tripId, minutes],
      { name: 'trip.shiftStops', primary: true },
    );
    return { oldDepartsAt: row.old_departs_at, newDepartsAt: row.new_departs_at };
  }

  /** Trips of a route on the given dates, with how many live bookings each has (#271). */
  tripsOnDates(
    routeId: RouteId,
    dates: string[],
  ): Promise<{ tripId: TripId; journeyDate: string; status: string; bookings: number }[]> {
    return this.db
      .query<{ id: TripId; journey_date: string; status: string; bookings: string }>(
        `SELECT t.id, t.journey_date::text AS journey_date, t.status,
                (SELECT count(*) FROM bookings b WHERE b.trip_id = t.id AND b.status IN ('held', 'confirmed')) AS bookings
           FROM trips t WHERE t.tenant_id = $1 AND t.route_id = $2 AND t.journey_date = ANY($3::date[])
            AND t.status IN ('scheduled', 'open')`,
        [requireTenantId(), routeId, dates],
        { name: 'trip.onDates', primary: true },
      )
      .then((rows) =>
        rows.map((r) => ({
          tripId: r.id,
          journeyDate: r.journey_date,
          status: r.status,
          bookings: Number(r.bookings),
        })),
      );
  }

  /** Cancel trips that nobody has booked (a blackout date). */
  async cancelUnbooked(tripIds: TripId[]): Promise<number> {
    if (tripIds.length === 0) return 0;
    return this.db.execute_(
      `UPDATE trips t SET status = 'cancelled', updated_at = now()
        WHERE t.tenant_id = $1 AND t.id = ANY($2::uuid[]) AND t.status IN ('scheduled', 'open')
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.trip_id = t.id AND b.status IN ('held', 'confirmed'))`,
      [requireTenantId(), tripIds],
      { name: 'trip.cancelUnbooked', primary: true },
    );
  }

  /** The sales rules of the trip's service ({} for a trip without one). */
  async salesRules(tripId: TripId): Promise<ServiceSalesRules> {
    const row = await this.db.queryOne<{ rules: ServiceSalesRules | null }>(
      `SELECT s.sales_rules AS rules FROM trips t LEFT JOIN services s ON s.id = t.service_id
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), tripId],
      { name: 'trip.salesRules' },
    );
    return row?.rules ?? {};
  }

  /** Open/close sales for channels on one trip (the service-level list still applies on top). */
  async setClosedChannels(tripId: TripId, channels: string[]): Promise<void> {
    await this.db.execute_(
      `UPDATE trips SET closed_channels = $3::text[], updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId, [...new Set(channels)]],
      { name: 'trip.setClosedChannels', primary: true },
    );
  }

  /** The luggage policy the trip's operator publishes (tenants.settings.luggage), or null. */
  async luggagePolicy(id: TripId): Promise<unknown> {
    const row = await this.db.queryOne<{ v: unknown }>(
      `SELECT t.settings->'luggage' AS v FROM trips tr JOIN tenants t ON t.id = tr.tenant_id WHERE tr.id = $1`,
      [id],
      { name: 'trip.luggagePolicy' },
    );
    return row?.v ?? null;
  }

  async getById(id: TripId): Promise<TripRecord> {
    const row = await this.db.queryOne<Row>(
      `SELECT id, service_id, route_id, vehicle_id, seat_layout_id, journey_date,
              departs_at, arrives_at, stop_count, total_seats, status
         FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'trip.getById' },
    );
    if (!row) throw new NotFoundError('Trip', id);
    return map(row);
  }

  /**
   * Whether the bus actually left (the crew marked it departed). 'closed' is
   * both "sales stopped" and "journey over", so status alone cannot tell.
   */
  async hasRun(id: TripId): Promise<boolean> {
    const row = await this.db.queryOne<{ ran: boolean }>(
      `SELECT actual_departed_at IS NOT NULL AS ran FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'trip.hasRun', primary: true },
    );
    return row?.ran ?? false;
  }

  /** Trips for a route on a date, open for sale — the search source set. */
  async findForSearch(routeId: RouteId, journeyDate: LocalDate): Promise<TripRecord[]> {
    const rows = await this.db.query<Row>(
      `SELECT id, service_id, route_id, vehicle_id, seat_layout_id, journey_date,
              departs_at, arrives_at, stop_count, total_seats, status
         FROM trips
        WHERE tenant_id = $1 AND route_id = $2 AND journey_date = $3 AND status = 'open'
        ORDER BY departs_at`,
      [requireTenantId(), routeId, journeyDate],
      { name: 'trip.findForSearch' },
    );
    return rows.map(map);
  }

  async setStatus(id: TripId, status: TripStatus): Promise<void> {
    await this.db.execute_(
      `UPDATE trips SET status = $3::trip_status, version = version + 1, updated_at = now(),
              actual_departed_at = CASE WHEN $3::trip_status = 'departed' THEN coalesce(actual_departed_at, now()) ELSE actual_departed_at END,
              -- 'closed' also means "sales stopped" before departure: only a bus
              -- that actually left arrives.
              actual_arrived_at = CASE WHEN $3::trip_status = 'closed' AND actual_departed_at IS NOT NULL
                                       THEN coalesce(actual_arrived_at, now()) ELSE actual_arrived_at END
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, status],
      { name: 'trip.setStatus', primary: true },
    );
  }

  /** Upcoming trips across every service — the staff "Trips" console view (search/scheduling both work per-service; this is the cross-service operational view for cancel/stop-sales day-to-day). */
  async listUpcoming(
    limit = 100,
    date?: string,
  ): Promise<
    (TripRecord & {
      routeName: string;
      /** The service's name (DEL-PAT-1500); null for a one-off trip. */
      serviceCode: string | null;
      /** The bus on this trip today — it can differ day to day. */
      busNumber: string | null;
      occupancyPct: number;
      bookedSeats: number;
      heldSeats: number;
    })[]
  > {
    // A day's trips (any status — the chart for a departed bus is still
    // needed), or everything still to leave. Seats: paid, and held by a
    // customer paying right now (an expired hold holds nothing).
    const rows = await this.db.query<
      Row & {
        route_name: string;
        service_code: string | null;
        bus_number: string | null;
        booked_seats: string;
        held_seats: string;
      }
    >(
      `SELECT t.id, t.service_id, t.route_id, t.vehicle_id, t.seat_layout_id, t.journey_date,
              t.departs_at, t.arrives_at, t.stop_count, t.total_seats, t.status,
              r.name AS route_name, s.code AS service_code, v.registration_no AS bus_number,
              coalesce((SELECT sum(b.seat_count) FROM bookings b
                         WHERE b.trip_id = t.id AND b.status IN ('confirmed', 'completed')), 0) AS booked_seats,
              coalesce((SELECT sum(b.seat_count) FROM bookings b
                         WHERE b.trip_id = t.id AND b.status = 'held' AND b.hold_expires_at > now()), 0) AS held_seats
         FROM trips t JOIN routes r ON r.id = t.route_id
         LEFT JOIN services s ON s.id = t.service_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.tenant_id = $1
          AND (CASE WHEN $3::date IS NULL THEN t.departs_at > now() AND t.status != 'cancelled'
                    ELSE t.journey_date = $3::date END)
        ORDER BY t.departs_at LIMIT $2`,
      [requireTenantId(), Math.min(limit, 300), date ?? null],
      { name: 'trip.listUpcoming' },
    );
    return rows.map((r) => ({
      ...map(r),
      routeName: r.route_name,
      serviceCode: r.service_code,
      busNumber: r.bus_number,
      bookedSeats: Number(r.booked_seats),
      heldSeats: Number(r.held_seats),
      occupancyPct:
        r.total_seats > 0 ? Math.round((Number(r.booked_seats) / r.total_seats) * 100) : 0,
    }));
  }

  /** Stop sequence for a trip — used to map (fromStopId,toStopId) → leg indices. */
  async loadStops(tripId: TripId): Promise<TripStopRow[]> {
    const rows = await this.db.query<StopRow>(
      `SELECT sequence, stop_id, arrives_at, departs_at, can_board, can_alight
         FROM trip_stops WHERE trip_id = $1 ORDER BY sequence`,
      [tripId],
      { name: 'trip.loadStops' },
    );
    return rows.map((r) => ({
      sequence: r.sequence,
      stopId: r.stop_id,
      arrivesAt: new Date(r.arrives_at),
      departsAt: new Date(r.departs_at),
      canBoard: r.can_board,
      canAlight: r.can_alight,
    }));
  }
}

interface Row {
  id: TripId;
  service_id: ServiceId;
  route_id: RouteId;
  vehicle_id: VehicleId | null;
  seat_layout_id: SeatLayoutId;
  journey_date: LocalDate;
  departs_at: Date;
  arrives_at: Date;
  stop_count: number;
  total_seats: number;
  status: TripStatus;
}
interface StopRow {
  sequence: number;
  stop_id: StopId;
  arrives_at: string;
  departs_at: string;
  can_board: boolean;
  can_alight: boolean;
}
function map(r: Row): TripRecord {
  return {
    id: r.id,
    serviceId: r.service_id,
    routeId: r.route_id,
    vehicleId: r.vehicle_id,
    seatLayoutId: r.seat_layout_id,
    journeyDate: r.journey_date,
    departsAt: new Date(r.departs_at),
    arrivesAt: new Date(r.arrives_at),
    stopCount: r.stop_count,
    totalSeats: r.total_seats,
    status: r.status,
  };
}
