import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { requireTenantId, type StopId, type TenantId, type TripId } from '@kernel';

export interface LiveRow {
  status: string;
  lat: number | null;
  lng: number | null;
  speedKmph: number;
  delayMinutes: number;
  lastPingAt: Date | null;
}

export interface TripClockRow {
  departsAt: Date;
  arrivesAt: Date;
  status: string;
  actualDepartedAt: Date | null;
  actualArrivedAt: Date | null;
  timezone: string;
  busNumber: string | null;
}

export interface CrewOnDuty {
  role: string;
  name: string;
  phone: string | null;
}

/**
 * gps_pings (append-only, day-partitioned) and trip_live (one row per trip,
 * the live map's cheap read). Reads marked "public" run without a tenant:
 * a trip id is globally unique.
 */
@Injectable()
export class TrackingRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  async insertPing(p: {
    tenantId: TenantId;
    tripId: TripId;
    vehicleId: string | null;
    lat: number;
    lng: number;
    speedKmph: number;
    headingDeg: number | null;
    distanceCoveredM: number;
    recordedAt: Date;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO gps_pings (tenant_id, trip_id, vehicle_id, lat, lng, speed_kmph, heading_deg, distance_covered_m, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        p.tenantId,
        p.tripId,
        p.vehicleId,
        p.lat,
        p.lng,
        p.speedKmph,
        p.headingDeg,
        p.distanceCoveredM,
        p.recordedAt,
      ],
      { name: 'tracking.ingestPing', primary: true },
    );
  }

  /** The trip's stops in order: distance from origin and scheduled departure. */
  tripStops(tripId: TripId): Promise<{ stopId: StopId; distanceM: number; departsAt: Date }[]> {
    return this.db.query(
      `SELECT ts.stop_id AS "stopId", rs.distance_from_origin_m AS "distanceM", ts.departs_at AS "departsAt"
         FROM trip_stops ts
         JOIN route_stops rs ON rs.route_id = (SELECT route_id FROM trips WHERE id = ts.trip_id)
                            AND rs.sequence = ts.sequence
        WHERE ts.trip_id = $1 ORDER BY ts.sequence`,
      [tripId],
      { name: 'tracking.tripStops' },
    );
  }

  async upsertLive(l: {
    tripId: TripId;
    tenantId: TenantId;
    lat: number;
    lng: number;
    speedKmph: number;
    distanceCoveredM: number;
    nextStopId: string | null;
    nextStopEtaAt: Date | null;
    delayMinutes: number;
    lastPingAt: Date;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO trip_live (trip_id, tenant_id, lat, lng, speed_kmph, distance_covered_m, next_stop_id, next_stop_eta_at, delay_minutes, status, last_ping_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running',$10)
       ON CONFLICT (trip_id) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, speed_kmph=EXCLUDED.speed_kmph,
         distance_covered_m=EXCLUDED.distance_covered_m, next_stop_id=EXCLUDED.next_stop_id,
         next_stop_eta_at=EXCLUDED.next_stop_eta_at, delay_minutes=EXCLUDED.delay_minutes,
         status='running', last_ping_at=EXCLUDED.last_ping_at, updated_at=now()`,
      [
        l.tripId,
        l.tenantId,
        l.lat,
        l.lng,
        l.speedKmph,
        l.distanceCoveredM,
        l.nextStopId,
        l.nextStopEtaAt,
        l.delayMinutes,
        l.lastPingAt,
      ],
      { name: 'tracking.upsertLive', primary: true },
    );
  }

  /** This operator's buses on the road now, with their last GPS fix (none yet = no row data). */
  fleetOnTheRoad(): Promise<Record<string, unknown>[]> {
    return this.db.query(
      `SELECT t.id AS "tripId", r.name AS "routeName", v.registration_no AS "bus", t.departs_at AS "departsAt",
              t.arrives_at AS "arrivesAt", l.lat, l.lng, l.speed_kmph AS "speedKmph", s.name AS "nextStop",
              l.next_stop_eta_at AS "nextStopEtaAt", l.delay_minutes AS "delayMinutes", l.last_ping_at AS "lastPingAt"
         FROM trips t
         JOIN routes r ON r.id = t.route_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN trip_live l ON l.trip_id = t.id
         LEFT JOIN stops s ON s.id = l.next_stop_id
        WHERE t.tenant_id = $1 AND t.status = 'departed'
        ORDER BY l.last_ping_at NULLS FIRST, t.departs_at`,
      [requireTenantId()],
      { name: 'tracking.fleet' },
    );
  }

  /** Public: the live position shown on "track my bus". */
  liveStatePublic(tripId: TripId): Promise<Record<string, unknown> | null> {
    return this.uow.run({ name: 'tracking.liveState', bypassRls: true }, async (scope) => {
      const r = await scope.client.query<Record<string, unknown>>(
        `SELECT lat, lng, speed_kmph AS "speedKmph", next_stop_id AS "nextStopId",
                next_stop_eta_at AS "nextStopEtaAt", delay_minutes AS "delayMinutes",
                status, last_ping_at AS "lastPingAt"
           FROM trip_live WHERE trip_id = $1`,
        [tripId],
      );
      return r.rows[0] ?? null;
    });
  }

  /** Public: which operator runs the trip. */
  tenantOfTripPublic(tripId: string): Promise<TenantId | null> {
    return this.uow.run({ name: 'tracking.resolveTenant', bypassRls: true }, async (scope) => {
      const r = await scope.client.query<{ tenant_id: TenantId }>(
        `SELECT tenant_id FROM trips WHERE id = $1`,
        [tripId],
      );
      return r.rows[0]?.tenant_id ?? null;
    });
  }

  async live(tripId: string): Promise<LiveRow | null> {
    return this.db.queryOne<LiveRow>(
      `SELECT status, lat, lng, speed_kmph AS "speedKmph", delay_minutes AS "delayMinutes",
              last_ping_at AS "lastPingAt"
         FROM trip_live WHERE trip_id = $1`,
      [tripId],
      { name: 'tracking.liveRow' },
    );
  }

  /** When the trip runs and where it is in its life — decides whether it can be tracked. */
  tripClock(tripId: string): Promise<TripClockRow | null> {
    return this.db.queryOne<TripClockRow>(
      `SELECT t.departs_at AS "departsAt", t.arrives_at AS "arrivesAt", t.status,
              t.actual_departed_at AS "actualDepartedAt", t.actual_arrived_at AS "actualArrivedAt",
              te.timezone, v.registration_no AS "busNumber"
         FROM trips t
         JOIN tenants te ON te.id = t.tenant_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), tripId],
      { name: 'tracking.tripClock' },
    );
  }

  /**
   * Everyone on duty for the trip — a long overnight run has two or three
   * drivers taking turns, a short one a single driver; plus the conductor /
   * attendants. Drivers first, then in shift order.
   */
  tripCrew(tripId: string): Promise<CrewOnDuty[]> {
    return this.db.query<CrewOnDuty>(
      `SELECT c.role::text AS role, c.full_name AS name, c.phone
         FROM crew_duties cd JOIN crew c ON c.id = cd.crew_id
        WHERE cd.tenant_id = $1 AND cd.trip_id = $2 AND cd.status <> 'cancelled' AND cd.attendance <> 'absent'
        ORDER BY (c.role = 'driver') DESC, cd.starts_at, c.full_name`,
      [requireTenantId(), tripId],
      { name: 'tracking.tripCrew' },
    );
  }

  /** The booking's boarding and dropping stop names. */
  bookingStopNames(
    tenantId: string,
    bookingId: string,
  ): Promise<{ fromStopName: string; toStopName: string; status: string } | null> {
    return this.db.queryOne(
      `SELECT fs.name AS "fromStopName", ts.name AS "toStopName", b.status
         FROM bookings b
         JOIN route_stops frs ON frs.route_id = b.route_id AND frs.sequence = b.from_seq
         JOIN route_stops trs ON trs.route_id = b.route_id AND trs.sequence = b.to_seq
         JOIN stops fs ON fs.id = frs.stop_id
         JOIN stops ts ON ts.id = trs.stop_id
        WHERE b.tenant_id = $1 AND b.id = $2`,
      [tenantId, bookingId],
      { name: 'tracking.stopNames' },
    );
  }

  /** The latest pings, oldest first (for drawing the recent path). */
  async recentPings(
    tripId: string,
    limit: number,
  ): Promise<{ lat: number; lng: number; recordedAt: Date }[]> {
    const rows = await this.db.query<{ lat: number; lng: number; recordedAt: Date }>(
      `SELECT lat, lng, recorded_at AS "recordedAt" FROM gps_pings
        WHERE trip_id = $1 ORDER BY recorded_at DESC LIMIT $2`,
      [tripId, limit],
      { name: 'tracking.recentPings' },
    );
    return rows.reverse();
  }
}
