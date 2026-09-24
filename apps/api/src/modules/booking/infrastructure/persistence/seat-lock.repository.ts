import { Injectable } from '@nestjs/common';

import { currentTransaction } from '@database';
import { AppError, ErrorCode, InternalError, type TripId } from '@kernel';

import { SegmentMap } from '../../../scheduling';

export interface SeatLockRequest {
  tripId: TripId;
  seatNumbers: string[];
  fromSeq: number;
  toSeq: number;
  stopCount: number;
  /**
   * Passenger gender for EACH seat being locked, keyed by seat number —
   * ladies-only enforcement is inherently per-seat/per-passenger, never a
   * single flag for the whole booking, since one booking can (and often
   * does) carry passengers of different genders across different seats.
   * A seat with no entry here (gender not supplied, or a booking flow
   * that doesn't collect it) is treated as unknown, NOT as female — see
   * the check below for why that direction of ambiguity is the safe one.
   */
  passengerGenderBySeat?: Record<string, string | undefined>;
}

export interface LockedSeat {
  seatNumber: string;
  legMask: bigint;
}

/**
 * ============================================================================
 *  Seat lock — the authoritative anti-double-sell gate
 * ============================================================================
 *
 * This is the single most correctness-critical piece of the platform. Every
 * seat sale funnels through `lockSeats`, which runs INSIDE the booking
 * transaction (it asserts an open unit of work) and does exactly this, in order:
 *
 *   1. `SELECT … FOR UPDATE` the requested trip_seats rows. This takes a row
 *      lock on each seat, so two concurrent buyers of the same seat SERIALISE —
 *      the second blocks until the first commits or rolls back. This is what
 *      turns "check then write" (a classic TOCTOU race) into an atomic
 *      operation.
 *
 *   2. For each seat, verify `(occupied_legs | blocked_legs) & segmentMask == 0`
 *      — the seat is free on every leg of the requested segment. Uses the exact
 *      same bitmap algebra as Part 5, so the check and the read model agree.
 *
 *   3. Verify no ACTIVE hold (another in-flight booking, status='held',
 *      not expired) overlaps the segment on the same seat. A hold from a buyer
 *      who is mid-payment must block us even though they haven't written
 *      occupied_legs yet.
 *
 * The caller then writes the hold (booking_seats) and, at confirm time, ORs the
 * mask into `occupied_legs`. Because everything happens under the row locks from
 * step 1, the whole sequence is free of the double-sell race by construction —
 * verified end-to-end against real PostgreSQL with concurrent transactions.
 */
@Injectable()
export class SeatLockRepository {
  // Stateless: every method runs on the caller's transaction (currentTransaction()).

  /**
   * Lock the requested seats and validate availability. Returns the per-seat
   * leg masks on success; throws INVENTORY_SEAT_UNAVAILABLE if any seat is taken
   * or held on the segment.
   */
  async lockSeats(req: SeatLockRequest): Promise<LockedSeat[]> {
    const tx = currentTransaction();
    if (!tx) {
      throw new InternalError('lockSeats must run inside a booking transaction');
    }

    const map = SegmentMap.forStops(req.stopCount);
    const mask = map.segmentMask(req.fromSeq, req.toSeq);

    // 1. Row-lock the seats. ORDER BY makes the lock order deterministic, which
    //    prevents deadlocks when two bookings request overlapping seat sets.
    const seatRows = await tx.client.query<{
      seat_number: string;
      occupied_legs: string;
      blocked_legs: string;
      is_bookable: boolean;
      ladies_only: boolean;
    }>(
      `SELECT seat_number, occupied_legs, blocked_legs, is_bookable, ladies_only
         FROM trip_seats
        WHERE trip_id = $1 AND seat_number = ANY($2)
        ORDER BY seat_number
        FOR UPDATE`,
      [req.tripId, req.seatNumbers],
    );

    if (seatRows.rows.length !== req.seatNumbers.length) {
      throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
        message: 'One or more requested seats do not exist on this trip',
      });
    }

    // 2. Bitmap availability check against confirmed + blocked legs.
    for (const row of seatRows.rows) {
      if (!row.is_bookable) {
        throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
          message: `Seat ${row.seat_number} is not bookable`,
          details: { seat: row.seat_number },
        });
      }
      if (row.ladies_only) {
        // Per-seat, not per-booking: THIS specific seat is ladies-only, so
        // whoever is assigned to it must be. An unknown/missing gender
        // (booking flow didn't collect one, or this seat wasn't in the
        // map at all) is rejected too, deliberately erring toward
        // BLOCKING an ambiguous assignment rather than silently letting
        // a not-provably-female passenger take a ladies-only seat — the
        // safe direction for a real passenger-safety commitment, not a
        // cosmetic label.
        const gender = req.passengerGenderBySeat?.[row.seat_number];
        if (gender?.toLowerCase() !== 'female') {
          throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
            message: `Seat ${row.seat_number} is reserved for a female passenger`,
            details: { seat: row.seat_number },
          });
        }
      }
      const occupied = BigInt(row.occupied_legs) | BigInt(row.blocked_legs);
      if ((occupied & mask) !== 0n) {
        throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
          message: `Seat ${row.seat_number} is unavailable on this segment`,
          details: { seat: row.seat_number },
        });
      }
    }

    // 3. Active-hold overlap check. A held (unexpired) booking that overlaps the
    //    segment on any requested seat blocks us.
    const heldRows = await tx.client.query<{ seat_number: string }>(
      `SELECT bs.seat_number
         FROM booking_seats bs
         JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.trip_id = $1
          AND bs.seat_number = ANY($2)
          AND b.status = 'held'
          AND b.hold_expires_at > now()
          AND (bs.leg_mask & $3) <> 0`,
      [req.tripId, req.seatNumbers, mask.toString()],
    );
    if (heldRows.rows.length > 0) {
      throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
        message: `Seat ${heldRows.rows[0].seat_number} is being booked by someone else`,
        details: { seat: heldRows.rows[0].seat_number, retryable: true },
      });
    }

    return req.seatNumbers.map((seatNumber) => ({ seatNumber, legMask: mask }));
  }

  /**
   * Commit the hold into confirmed occupancy: OR the leg mask into each seat's
   * `occupied_legs`. Runs under the same transaction; re-checks the bit is still
   * free as a final assertion (it must be, since we hold the row lock).
   */
  /**
   * Mark the seats occupied on their legs — ONE statement for all seats.
   * The `(occupied_legs & mask) = 0` guard is kept per row: if any seat's legs
   * were taken concurrently (impossible under the hold's row lock, but never
   * trusted), fewer rows come back and the whole confirm fails with a clear
   * 409 naming the seat(s).
   */
  async commitOccupancy(tripId: TripId, seats: LockedSeat[]): Promise<void> {
    const tx = currentTransaction();
    if (!tx) throw new InternalError('commitOccupancy must run inside a transaction');
    if (seats.length === 0) return;

    const res = await tx.client.query<{ seat_number: string }>(
      `UPDATE trip_seats t
          SET occupied_legs = t.occupied_legs | u.mask, version = t.version + 1
         FROM unnest($2::text[], $3::bigint[]) AS u(seat_number, mask)
        WHERE t.trip_id = $1 AND t.seat_number = u.seat_number
          AND (t.occupied_legs & u.mask) = 0
        RETURNING t.seat_number`,
      [tripId, seats.map((s) => s.seatNumber), seats.map((s) => s.legMask.toString())],
    );
    if (res.rowCount !== seats.length) {
      const done = new Set(res.rows.map((r) => r.seat_number));
      const lost = seats.map((s) => s.seatNumber).filter((n) => !done.has(n));
      throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 409, {
        message: `Seat ${lost.join(', ')} was taken concurrently`,
        retryable: true,
      });
    }
  }

  /** Free the seats' legs — ONE statement for all seats. Idempotent (clearing already-clear bits is a no-op). */
  async releaseOccupancy(tripId: TripId, seats: LockedSeat[]): Promise<void> {
    const tx = currentTransaction();
    if (!tx) throw new InternalError('releaseOccupancy must run inside a transaction');
    if (seats.length === 0) return;
    await tx.client.query(
      `UPDATE trip_seats t
          SET occupied_legs = t.occupied_legs & ~u.mask, version = t.version + 1
         FROM unnest($2::text[], $3::bigint[]) AS u(seat_number, mask)
        WHERE t.trip_id = $1 AND t.seat_number = u.seat_number`,
      [tripId, seats.map((s) => s.seatNumber), seats.map((s) => s.legMask.toString())],
    );
  }
}
