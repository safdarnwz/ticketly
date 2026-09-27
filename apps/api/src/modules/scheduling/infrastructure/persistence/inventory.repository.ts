import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type StopId, type TripId } from '@kernel';

export interface SeatAvailability {
  seatNumber: string;
  seatType: string;
  ladiesOnly: boolean;
  /** Disability-friendly seat (#141). */
  accessible: boolean;
  available: boolean;
}

/**
 * ============================================================================
 *  Segment availability read model
 * ============================================================================
 *
 * The fast side of the leg-bitmap design. "How many seats are free on A→C?" is
 * ONE aggregate with a bitwise AND against `segment_mask`, using the partial
 * index on trip_seats — no per-seat loop, no per-segment materialised table to
 * keep in sync. This is what lets search (Part 6) price and rank dozens of
 * trips in a handful of milliseconds.
 *
 * Reads run on a replica (they never inform a write decision here; the actual
 * seat lock at booking time in Part 7 re-checks on the primary under a row
 * lock, which is the authoritative gate against double-selling).
 */
/**
 * A seat someone is paying for right now: an unexpired hold overlapping the
 * segment. Holds live on booking_seats, not in occupied_legs (which only a
 * confirmed booking sets), so without this a held seat looks free and the
 * next customer only finds out when their own hold is refused.
 */
const LIVE_HOLD = (tripCol: string, seatCol: string, mask: string) => `EXISTS (
  SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
   WHERE bs.trip_id = ${tripCol} AND bs.seat_number = ${seatCol}
     AND b.status = 'held' AND b.hold_expires_at > now()
     AND (bs.leg_mask & ${mask}) <> 0)`;

@Injectable()
export class InventoryRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Count of available seats for a segment [fromSeq, toSeq). */
  async availableCount(tripId: TripId, fromSeq: number, toSeq: number): Promise<number> {
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM trip_seats
        WHERE tenant_id = $1 AND trip_id = $2 AND is_bookable
          AND ((occupied_legs | blocked_legs) & segment_mask($3, $4)) = 0`,
      [requireTenantId(), tripId, fromSeq, toSeq],
      { name: 'inventory.availableCount' },
    );
    return row?.n ?? 0;
  }

  /** Available counts for many trips at once (search fan-out), one round trip. */
  async availableCountForTrips(
    trips: readonly { tripId: TripId; fromSeq: number; toSeq: number }[],
  ): Promise<Map<TripId, number>> {
    if (trips.length === 0) return new Map();
    // VALUES list of (trip, from, to) joined against a lateral aggregate.
    const params: unknown[] = [requireTenantId()];
    const values = trips.map((t, i) => {
      const b = i * 3;
      params.push(t.tripId, t.fromSeq, t.toSeq);
      return `($${b + 2}::uuid, $${b + 3}::int, $${b + 4}::int)`;
    });
    const rows = await this.db.query<{ trip_id: TripId; n: number }>(
      `SELECT q.trip_id, count(*)::int AS n
         FROM (VALUES ${values.join(',')}) AS q(trip_id, from_seq, to_seq)
         JOIN trip_seats s ON s.trip_id = q.trip_id AND s.tenant_id = $1 AND s.is_bookable
          AND ((s.occupied_legs | s.blocked_legs) & segment_mask(q.from_seq, q.to_seq)) = 0
          AND NOT ${LIVE_HOLD('s.trip_id', 's.seat_number', 'segment_mask(q.from_seq, q.to_seq)')}
        GROUP BY q.trip_id`,
      params,
      { name: 'inventory.availableCountForTrips' },
    );
    const result = new Map<TripId, number>(trips.map((t) => [t.tripId, 0]));
    for (const row of rows) result.set(row.trip_id, row.n);
    return result;
  }

  /** The seat types each trip sells (seater / sleeper / semi_sleeper), for search filters and prices. */
  async seatTypesForTrips(tripIds: readonly TripId[]): Promise<Map<TripId, string[]>> {
    const result = new Map<TripId, string[]>(tripIds.map((id) => [id, []]));
    if (tripIds.length === 0) return result;
    const rows = await this.db.query<{ trip_id: TripId; types: string[] }>(
      `SELECT trip_id, array_agg(DISTINCT seat_type ORDER BY seat_type) AS types
         FROM trip_seats
        WHERE tenant_id = $1 AND trip_id = ANY($2::uuid[]) AND is_bookable
        GROUP BY trip_id`,
      [requireTenantId(), tripIds],
      { name: 'inventory.seatTypesForTrips' },
    );
    for (const row of rows) result.set(row.trip_id, row.types);
    return result;
  }

  /**
   * The traveller's gender on every seat taken on this stretch (paid, or being
   * paid for right now) — only the gender, for the "for women / for men" seat
   * rule. `excludeBookingId` leaves one booking out (a booking changing seats).
   */
  async seatGenders(
    tripId: TripId,
    fromSeq: number,
    toSeq: number,
    excludeBookingId?: string,
  ): Promise<Map<string, 'female' | 'male' | null>> {
    const rows = await this.db.query<{ seat_number: string; gender: string | null }>(
      `SELECT DISTINCT ON (bs.seat_number) bs.seat_number, p.gender
         FROM booking_seats bs
         JOIN bookings b ON b.id = bs.booking_id
         LEFT JOIN passengers p ON p.booking_id = b.id AND p.seat_number = bs.seat_number
        WHERE bs.tenant_id = $1 AND bs.trip_id = $2
          AND (bs.leg_mask & segment_mask($3, $4)) <> 0
          AND (b.status IN ('confirmed','completed') OR (b.status = 'held' AND b.hold_expires_at > now()))
          AND ($5::uuid IS NULL OR b.id <> $5)
        ORDER BY bs.seat_number, b.created_at DESC`,
      [requireTenantId(), tripId, fromSeq, toSeq, excludeBookingId ?? null],
      { name: 'inventory.seatGenders' },
    );
    return new Map(
      rows.map((r) => [
        r.seat_number,
        r.gender === 'female' || r.gender === 'male' ? r.gender : null,
      ]),
    );
  }

  /** The operator's "who sits next to whom" rule (passenger_policies; 'off' when never set). */
  async adjacentSeatRule(): Promise<'off' | 'women' | 'both'> {
    const r = await this.db.queryOne<{ rule: 'off' | 'women' | 'both' }>(
      `SELECT adjacent_seat_rule AS rule FROM passenger_policies WHERE tenant_id = $1`,
      [requireTenantId()],
      { name: 'inventory.adjacentSeatRule' },
    );
    return r?.rule ?? 'off';
  }

  /** Per-seat availability for the seat-map render. */
  async seatAvailability(
    tripId: TripId,
    fromSeq: number,
    toSeq: number,
  ): Promise<SeatAvailability[]> {
    const rows = await this.db.query<{
      seat_number: string;
      seat_type: string;
      ladies_only: boolean;
      accessible: boolean;
      available: boolean;
    }>(
      `SELECT seat_number, seat_type, ladies_only, accessible,
              (is_bookable AND ((occupied_legs | blocked_legs) & segment_mask($3, $4)) = 0
               AND NOT ${LIVE_HOLD('ts.trip_id', 'ts.seat_number', 'segment_mask($3, $4)')}) AS available
         FROM trip_seats ts
        WHERE tenant_id = $1 AND trip_id = $2
        ORDER BY seat_number`,
      [requireTenantId(), tripId, fromSeq, toSeq],
      { name: 'inventory.seatAvailability' },
    );
    return rows.map((r) => ({
      seatNumber: r.seat_number,
      seatType: r.seat_type,
      ladiesOnly: r.ladies_only,
      accessible: r.accessible,
      available: r.available,
    }));
  }

  /** Seat number → seat type (and bookability) for the given seats of a trip. */
  async seatTypes(
    tripId: TripId,
    seatNumbers: string[],
  ): Promise<Map<string, { seatType: string; bookable: boolean }>> {
    if (seatNumbers.length === 0) return new Map();
    const rows = await this.db.query<{
      seat_number: string;
      seat_type: string;
      is_bookable: boolean;
    }>(
      `SELECT seat_number, seat_type, is_bookable FROM trip_seats WHERE tenant_id = $1 AND trip_id = $2 AND seat_number = ANY($3::text[])`,
      [requireTenantId(), tripId, seatNumbers],
      { name: 'inventory.seatTypes' },
    );
    return new Map(
      rows.map((r) => [r.seat_number, { seatType: r.seat_type, bookable: r.is_bookable }]),
    );
  }

  /**
   * Block or unblock a set of seats on a segment (operator quota / hold).
   * Uses the same bitmap: block ORs the mask into `blocked_legs`.
   */
  async blockSeats(
    tripId: TripId,
    seatNumbers: string[],
    fromSeq: number,
    toSeq: number,
    block: boolean,
  ): Promise<number> {
    if (seatNumbers.length === 0) return 0;
    const op = block ? `blocked_legs | segment_mask($3,$4)` : `blocked_legs & ~segment_mask($3,$4)`;
    return this.db.execute_(
      `UPDATE trip_seats SET blocked_legs = ${op}, version = version + 1
        WHERE tenant_id = $1 AND trip_id = $2 AND seat_number = ANY($5)`,
      [requireTenantId(), tripId, fromSeq, toSeq, seatNumbers],
      { name: 'inventory.blockSeats', primary: true },
    );
  }

  /** Seats kept off sale on some or all of the route (blocked), and seats never for sale. */
  async heldBack(
    tripId: TripId,
  ): Promise<{ seatNumber: string; blocked: boolean; bookable: boolean }[]> {
    const rows = await this.db.query<{
      seat_number: string;
      blocked: boolean;
      is_bookable: boolean;
    }>(
      `SELECT seat_number, blocked_legs <> 0 AS blocked, is_bookable
         FROM trip_seats WHERE trip_id = $1 AND (blocked_legs <> 0 OR NOT is_bookable)`,
      [tripId],
      { name: 'inventory.heldBack' },
    );
    return rows.map((r) => ({
      seatNumber: r.seat_number,
      blocked: r.blocked,
      bookable: r.is_bookable,
    }));
  }

  /** Map a (fromStopId, toStopId) pair to leg sequence indices for a trip. */
  async resolveSegment(
    tripId: TripId,
    fromStopId: StopId,
    toStopId: StopId,
  ): Promise<{ fromSeq: number; toSeq: number } | null> {
    const rows = await this.db.query<{
      stop_id: StopId;
      sequence: number;
      can_board: boolean;
      can_alight: boolean;
    }>(
      `SELECT stop_id, sequence, can_board, can_alight FROM trip_stops WHERE trip_id = $1 ORDER BY sequence`,
      [tripId],
      { name: 'inventory.resolveSegment' },
    );
    const from = rows.find((r) => r.stop_id === fromStopId);
    const to = rows.find((r) => r.stop_id === toStopId);
    if (!from || !to || from.sequence >= to.sequence || !from.can_board || !to.can_alight)
      return null;
    return { fromSeq: from.sequence, toSeq: to.sequence };
  }
}
