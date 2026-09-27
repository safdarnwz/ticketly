import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, requireTenantId } from '@kernel';

import { ticketCode } from '../../booking';

export interface TripRow {
  id: string;
  vehicle_id: string | null;
  seat_layout_id: string;
  status: string;
  departs_at: Date;
  arrives_at: Date;
  journey_date: string;
  actual_departed_at: Date | null;
}
export interface SeatRow {
  seatNumber: string;
  seatType: string;
  occupied: bigint;
  blocked: bigint;
  ladiesOnly: boolean;
}
export interface NewSeat {
  seatNumber: string;
  seatType: string;
  bookable: boolean;
  ladiesOnly: boolean;
  /** Disability-friendly on the NEW bus's layout (#141). */
  accessible?: boolean;
  occupied: bigint;
  blocked: bigint;
}

/** Persistence for changing a trip's bus. Joins the caller's transaction (row locks as before). */
@Injectable()
export class TripVehicleRepository {
  constructor(private readonly db: DatabaseService) {}

  lockTrip(tripId: string): Promise<TripRow | null> {
    return this.db.queryOne<TripRow>(
      `SELECT id, vehicle_id, seat_layout_id, status::text AS status, departs_at, arrives_at, journey_date::text AS journey_date,
              actual_departed_at
         FROM trips WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), tripId],
      { name: 'tripVehicle.lockTrip' },
    );
  }

  /** Other trips of the bus within a day either side (the caller checks the exact overlap). */
  otherTripsOfVehicle(vehicleId: string, exceptTripId: string, departsAt: Date, arrivesAt: Date) {
    return this.db.query<{ id: string; departs_at: Date; arrives_at: Date }>(
      `SELECT id, departs_at, arrives_at FROM trips
        WHERE tenant_id = $1 AND vehicle_id = $2 AND id <> $3 AND status IN ('scheduled', 'open', 'departed')
          AND departs_at < $5::timestamptz + interval '1 day' AND arrives_at > $4::timestamptz - interval '1 day'`,
      [requireTenantId(), vehicleId, exceptTripId, departsAt, arrivesAt],
      { name: 'tripVehicle.otherTrips' },
    );
  }

  async setVehicle(tripId: string, vehicleId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE trips SET vehicle_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId, vehicleId],
      { name: 'tripVehicle.setVehicle' },
    );
  }

  async lockSeats(tripId: string): Promise<SeatRow[]> {
    return (
      await this.db.query<{
        seat_number: string;
        seat_type: string;
        occupied_legs: string;
        blocked_legs: string;
        ladies_only: boolean;
      }>(
        `SELECT seat_number, seat_type, occupied_legs, blocked_legs, ladies_only FROM trip_seats WHERE tenant_id = $1 AND trip_id = $2 FOR UPDATE`,
        [requireTenantId(), tripId],
        { name: 'tripVehicle.lockSeats' },
      )
    ).map((r) => ({
      seatNumber: r.seat_number,
      seatType: r.seat_type,
      occupied: BigInt(r.occupied_legs),
      blocked: BigInt(r.blocked_legs),
      ladiesOnly: r.ladies_only,
    }));
  }

  /** Seats among `seats` that a customer is paying for right now (live hold, not yet in the bitmap). */
  async seatsInLiveHolds(tripId: string, seats: string[]): Promise<string[]> {
    return (
      await this.db.query<{ seat_number: string }>(
        `SELECT DISTINCT bs.seat_number FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
        WHERE b.tenant_id = $1 AND bs.trip_id = $2 AND b.status = 'held' AND b.hold_expires_at > now() AND bs.seat_number = ANY($3::text[])`,
        [requireTenantId(), tripId, seats],
        { name: 'tripVehicle.liveHolds' },
      )
    ).map((r) => r.seat_number);
  }

  /** Replace the trip's seat inventory with the new layout (bitmaps carried) and point the trip at the new bus. */
  async rebuildInventory(
    tripId: string,
    vehicleId: string,
    layoutId: string,
    seats: NewSeat[],
  ): Promise<void> {
    const tenantId = requireTenantId();
    await this.db.execute_(
      `DELETE FROM trip_seats WHERE tenant_id = $1 AND trip_id = $2`,
      [tenantId, tripId],
      { name: 'tripVehicle.clearSeats' },
    );
    await this.db.execute_(
      `INSERT INTO trip_seats (trip_id, tenant_id, seat_number, seat_type, is_bookable, ladies_only, occupied_legs, blocked_legs, accessible)
       SELECT $1, $2, s.n, s.t, s.b, s.l, s.o, s.k, s.a
         FROM unnest($3::text[], $4::text[], $5::boolean[], $6::boolean[], $7::bigint[], $8::bigint[], $9::boolean[]) AS s(n, t, b, l, o, k, a)`,
      [
        tripId,
        tenantId,
        seats.map((s) => s.seatNumber),
        seats.map((s) => s.seatType),
        seats.map((s) => s.bookable),
        seats.map((s) => s.ladiesOnly),
        seats.map((s) => s.occupied.toString()),
        seats.map((s) => s.blocked.toString()),
        seats.map((s) => s.accessible === true),
      ],
      { name: 'tripVehicle.insertSeats' },
    );
    await this.db.execute_(
      `UPDATE trips SET vehicle_id = $3, seat_layout_id = $4, total_seats = $5, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, tripId, vehicleId, layoutId, seats.filter((s) => s.bookable).length],
      { name: 'tripVehicle.setLayout' },
    );
  }

  /**
   * Move every record that names a seat — booking seats, passengers, tickets
   * (new boarding codes, two steps so a swap never collides on the unique
   * code), live quotas. Returns how many bookings were affected.
   */
  async moveSeats(tripId: string, moves: { from: string; to: string }[]): Promise<number> {
    if (!moves.length) return 0;
    const tenantId = requireTenantId();
    const from = moves.map((m) => m.from);
    const to = moves.map((m) => m.to);
    const moved = await this.db.query<{ booking_id: string }>(
      `UPDATE booking_seats bs SET seat_number = u.to_seat FROM unnest($3::text[], $4::text[]) AS u(from_seat, to_seat)
        WHERE bs.tenant_id = $1 AND bs.trip_id = $2 AND bs.seat_number = u.from_seat RETURNING bs.booking_id`,
      [tenantId, tripId, from, to],
      { name: 'tripVehicle.moveBookingSeats', primary: true },
    );
    await this.db.execute_(
      `UPDATE passengers p SET seat_number = u.to_seat FROM unnest($3::text[], $4::text[]) AS u(from_seat, to_seat), bookings b
        WHERE p.booking_id = b.id AND b.tenant_id = $1 AND b.trip_id = $2 AND p.seat_number = u.from_seat`,
      [tenantId, tripId, from, to],
      { name: 'tripVehicle.movePassengers' },
    );
    const tickets = await this.db.query<{ id: string; seat_number: string; pnr: string }>(
      `SELECT t.id, t.seat_number, b.pnr FROM tickets t JOIN bookings b ON b.id = t.booking_id
        WHERE t.tenant_id = $1 AND t.trip_id = $2 AND t.seat_number = ANY($3::text[])`,
      [tenantId, tripId, from],
      { name: 'tripVehicle.tickets', primary: true },
    );
    if (tickets.length) {
      const toByFrom = new Map(moves.map((m) => [m.from, m.to]));
      await this.db.execute_(
        `UPDATE tickets SET boarding_code = boarding_code || ':' || id WHERE id = ANY($1::uuid[])`,
        [tickets.map((t) => t.id)],
        { name: 'tripVehicle.ticketsTmp' },
      );
      await this.db.execute_(
        `UPDATE tickets t SET seat_number = u.seat, boarding_code = u.code FROM unnest($1::uuid[], $2::text[], $3::text[]) AS u(id, seat, code) WHERE t.id = u.id`,
        [
          tickets.map((t) => t.id),
          tickets.map((t) => toByFrom.get(t.seat_number)!),
          tickets.map((t) => ticketCode(t.pnr, toByFrom.get(t.seat_number)!)),
        ],
        { name: 'tripVehicle.ticketsMove' },
      );
    }
    await this.db.execute_(
      `UPDATE seat_quotas q SET seat_number = u.to_seat FROM unnest($3::text[], $4::text[]) AS u(from_seat, to_seat)
        WHERE q.tenant_id = $1 AND q.trip_id = $2 AND q.seat_number = u.from_seat AND q.released_at IS NULL AND q.consumed_at IS NULL`,
      [tenantId, tripId, from, to],
      { name: 'tripVehicle.moveQuotas' },
    );
    return new Set(moved.map((r) => r.booking_id)).size;
  }

  async audit(a: {
    tripId: string;
    from: string | null;
    to: string;
    fromLayout: string;
    toLayout: string;
    reason: string;
    moves: unknown[];
    affected: number;
    actor: string | null;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO trip_vehicle_changes (id, tenant_id, trip_id, from_vehicle_id, to_vehicle_id, from_layout_id, to_layout_id, reason, seat_moves, bookings_affected, changed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        newId(),
        requireTenantId(),
        a.tripId,
        a.from,
        a.to,
        a.fromLayout,
        a.toLayout,
        a.reason,
        JSON.stringify(a.moves),
        a.affected,
        a.actor,
      ],
      { name: 'tripVehicle.audit' },
    );
  }

  history(tripId: string) {
    return this.db.query(
      `SELECT c.id, c.reason, c.seat_moves AS "seatMoves", c.bookings_affected AS "bookingsAffected", c.created_at AS "createdAt",
              fv.registration_no AS "fromBus", tv.registration_no AS "toBus", u.full_name AS "changedBy"
         FROM trip_vehicle_changes c
         LEFT JOIN vehicles fv ON fv.id = c.from_vehicle_id
         JOIN vehicles tv ON tv.id = c.to_vehicle_id
         LEFT JOIN users u ON u.id = c.changed_by
        WHERE c.tenant_id = $1 AND c.trip_id = $2 ORDER BY c.created_at DESC`,
      [requireTenantId(), tripId],
      { name: 'tripVehicle.history' },
    );
  }
}
