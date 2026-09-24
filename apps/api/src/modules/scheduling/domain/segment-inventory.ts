import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Segment-wise seat inventory — the leg-bitmap model
 * ============================================================================
 *
 * THE PROBLEM THIS SOLVES (and the reason a bus GDS is harder than it looks):
 *
 * A single seat can be sold to DIFFERENT passengers on DIFFERENT parts of the
 * same trip. On a route A → B → C → D:
 *   - Passenger 1 books seat 5 from A to C.
 *   - Seat 5 must now be UNAVAILABLE for A-B, A-C and B-C …
 *   - … but STILL AVAILABLE for C-D, and it can be sold to Passenger 2 for C-D.
 *
 * Getting this wrong means either double-selling a seat (two passengers, one
 * seat, same leg — a furious customer) or leaving money on the table (refusing
 * a C-D booking because the seat "looks taken").
 *
 * THE REPRESENTATION:
 *
 * A route with N stops has N-1 "legs" (A-B, B-C, C-D). We model each seat's
 * occupancy on a trip as a **bitmask over legs**: bit `i` set = leg `i` is
 * occupied for this seat. Booking a segment from stop `fromSeq` to stop `toSeq`
 * occupies legs `[fromSeq, toSeq)`.
 *
 *   A(0) B(1) C(2) D(3)      legs:  0=A-B  1=B-C  2=C-D
 *   book A→C  → occupy legs {0,1} → mask 0b011
 *   book C→D  → occupy leg  {2}   → mask 0b100
 *   the two masks don't intersect → BOTH bookings coexist on one seat.
 *
 * AVAILABILITY is then a single bitwise AND:
 *   seat is free for (from,to)  ⇔  occupied & segmentMask(from,to) == 0
 *
 * This is O(1) per seat, and — crucially — it maps directly onto a PostgreSQL
 * `bigint` column with native `&` operators, so "how many seats are free on
 * A→C?" is one indexed aggregate query, not a per-seat loop (see the repository
 * in Part 5). BigInt is used here so the model is correct up to 62 legs
 * (63 stops); real routes are far smaller.
 *
 * INVARIANT: this module is pure and holds no seat state itself — it computes
 * masks and answers questions about a given occupancy value. The trip/seat
 * occupancy lives in the database; this is the algebra over it.
 */

export const MAX_LEGS = 62; // fits a signed 63-bit Postgres bigint with headroom

export class SegmentMap {
  private constructor(
    readonly stopCount: number,
    readonly legCount: number,
  ) {}

  static forStops(stopCount: number): SegmentMap {
    if (stopCount < 2) {
      throw new DomainError(ErrorCode.INVENTORY_SEGMENT_INVALID, 'A trip needs at least 2 stops');
    }
    if (stopCount - 1 > MAX_LEGS) {
      throw new DomainError(
        ErrorCode.INVENTORY_SEGMENT_INVALID,
        `Routes with more than ${MAX_LEGS + 1} stops are not supported by the bitmap inventory model`,
      );
    }
    return new SegmentMap(stopCount, stopCount - 1);
  }

  /**
   * The leg-bitmask for a segment [fromSeq, toSeq). Legs fromSeq … toSeq-1.
   * Validates the pair is a real forward segment on this route.
   */
  segmentMask(fromSeq: number, toSeq: number): bigint {
    if (!Number.isInteger(fromSeq) || !Number.isInteger(toSeq)) {
      throw invalid('Segment endpoints must be integers');
    }
    if (fromSeq < 0 || toSeq > this.stopCount - 1 || fromSeq >= toSeq) {
      throw invalid(`Invalid segment (${fromSeq} → ${toSeq}) on a ${this.stopCount}-stop route`);
    }
    // Bits [fromSeq, toSeq): ((1<<toSeq) - 1) with the low fromSeq bits cleared.
    const high = (1n << BigInt(toSeq)) - 1n;
    const low = (1n << BigInt(fromSeq)) - 1n;
    return high ^ low;
  }

  /** Is a seat with `occupied` legs free for the whole requested segment? */
  isFree(occupied: bigint, fromSeq: number, toSeq: number): boolean {
    return (occupied & this.segmentMask(fromSeq, toSeq)) === 0n;
  }

  /** Occupancy after booking the segment. Throws if it would double-book. */
  occupy(occupied: bigint, fromSeq: number, toSeq: number): bigint {
    const mask = this.segmentMask(fromSeq, toSeq);
    if ((occupied & mask) !== 0n) {
      throw new DomainError(
        ErrorCode.INVENTORY_SEAT_UNAVAILABLE,
        'Seat is already occupied on part of this segment',
      );
    }
    return occupied | mask;
  }

  /** Occupancy after releasing the segment (cancellation). */
  release(occupied: bigint, fromSeq: number, toSeq: number): bigint {
    return occupied & ~this.segmentMask(fromSeq, toSeq);
  }

  /** True when the seat carries no occupancy at all (fully free). */
  isEmpty(occupied: bigint): boolean {
    return occupied === 0n;
  }

  /** Number of occupied legs — for utilisation metrics. */
  occupiedLegCount(occupied: bigint): number {
    let count = 0;
    let value = occupied;
    while (value > 0n) {
      count += Number(value & 1n);
      value >>= 1n;
    }
    return count;
  }

  /**
   * All maximal free sub-segments for a seat, as [fromSeq,toSeq] stop pairs.
   * Useful for the seat-map UI ("this berth is free C→D").
   */
  freeSegments(occupied: bigint): { from: number; to: number }[] {
    const out: { from: number; to: number }[] = [];
    let start: number | null = null;
    for (let leg = 0; leg < this.legCount; leg += 1) {
      const busy = (occupied & (1n << BigInt(leg))) !== 0n;
      if (!busy && start === null) start = leg;
      if (busy && start !== null) {
        out.push({ from: start, to: leg });
        start = null;
      }
    }
    if (start !== null) out.push({ from: start, to: this.legCount });
    return out;
  }
}

function invalid(message: string): DomainError {
  return new DomainError(ErrorCode.INVENTORY_SEGMENT_INVALID, message);
}
