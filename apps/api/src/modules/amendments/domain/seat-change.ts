/**
 * ============================================================================
 *  Same-trip seat change — pure planning
 * ============================================================================
 *
 * Rule (deterministic, never depends on DB row order):
 *   - a passenger whose current seat is also in the new list STAYS on it;
 *   - every other passenger moves to the remaining new seats, both sides
 *     taken in natural seat order ("2" < "10", "L1" < "L2" < "U1").
 * The fare a passenger paid travels with them, so the booking total and every
 * seat's refundable amount stay exactly what was paid.
 */
export interface CurrentSeat {
  seatNumber: string;
  fareMinor: number;
}
export interface SeatMove {
  from: string;
  to: string;
  fareMinor: number;
}

export class SeatChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeatChangeError';
  }
}

const natural = (a: string, b: string) =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export function planSeatChange(
  current: CurrentSeat[],
  requested: string[],
): { moves: SeatMove[]; kept: string[] } {
  const next = requested.map((s) => String(s ?? '').trim());
  if (next.some((s) => s === '')) throw new SeatChangeError('Seat numbers cannot be blank');
  const dup = next.find((s, i) => next.indexOf(s) !== i);
  if (dup) throw new SeatChangeError(`Seat ${dup} was selected more than once`);
  if (next.length !== current.length)
    throw new SeatChangeError(
      `Select exactly ${current.length} seat(s) — the number of seats cannot change`,
    );

  const nextSet = new Set(next);
  const currentSet = new Set(current.map((c) => c.seatNumber));
  const kept = current
    .map((c) => c.seatNumber)
    .filter((s) => nextSet.has(s))
    .sort(natural);
  const movingFrom = current
    .filter((c) => !nextSet.has(c.seatNumber))
    .sort((a, b) => natural(a.seatNumber, b.seatNumber));
  const movingTo = next.filter((s) => !currentSet.has(s)).sort(natural);
  if (movingFrom.length === 0)
    throw new SeatChangeError('These are already your seats — nothing to change');

  return {
    moves: movingFrom.map((c, i) => ({
      from: c.seatNumber,
      to: movingTo[i],
      fareMinor: c.fareMinor,
    })),
    kept,
  };
}
