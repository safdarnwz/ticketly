/**
 * ============================================================================
 *  Seat-hold request validation — pure
 * ============================================================================
 *
 * Every channel (web, agent, OTA, connecting journeys) holds seats through
 * BookingService.hold, so these rules protect all of them at once:
 *
 *   - seat numbers are non-empty and unique (a duplicate would lock one seat
 *     twice and charge for two);
 *   - exactly one passenger per selected seat, and no passenger on a seat
 *     that was not selected;
 *   - the seats held are EXACTLY the seats the quote priced. Otherwise a
 *     quote for two cheap seats could be used to hold two premium (window /
 *     lower-berth override) seats at the cheap price.
 *
 * Per-seat fares come from the quote itself, never from an equal split of
 * the total — partial cancellations refund each seat by what it cost.
 */
export interface HoldPassenger { seatNumber: string; fullName: string }

export type SeatFareResolution =
  | { kind: 'priced'; fareBySeat: Map<string, number> }
  | { kind: 'needs_seat_quote' };

export class HoldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HoldValidationError';
  }
}

/** Seat labels are exact (layouts may use 'U1' and 'u1' differently) — only surrounding spaces are ignored. */
export function normaliseSeat(seat: string): string {
  return String(seat ?? '').trim();
}

export function validateHoldSelection(seatNumbers: string[], passengers: HoldPassenger[], quoteSeatCount: number): void {
  if (!Array.isArray(seatNumbers) || seatNumbers.length === 0) throw new HoldValidationError('Select at least one seat');
  const seats = seatNumbers.map(normaliseSeat);
  if (seats.some((s) => s === '')) throw new HoldValidationError('Seat numbers cannot be blank');
  const dup = seats.find((s, i) => seats.indexOf(s) !== i);
  if (dup) throw new HoldValidationError(`Seat ${dup} was selected more than once`);
  if (seats.length !== quoteSeatCount) {
    throw new HoldValidationError(`Quote is for ${quoteSeatCount} seat(s) but ${seats.length} were selected`);
  }
  if (!Array.isArray(passengers) || passengers.length !== seats.length) {
    throw new HoldValidationError(`Enter exactly one passenger per seat (${seats.length} seat(s), ${passengers?.length ?? 0} passenger(s))`);
  }
  const selected = new Set(seats);
  const taken = new Set<string>();
  for (const p of passengers) {
    const seat = normaliseSeat(p.seatNumber);
    if (!selected.has(seat)) throw new HoldValidationError(`Passenger references unknown seat ${p.seatNumber}`);
    if (taken.has(seat)) throw new HoldValidationError(`Two passengers are assigned to seat ${seat}`);
    taken.add(seat);
    if (!p.fullName?.trim()) throw new HoldValidationError(`Passenger name is required for seat ${seat}`);
  }
}

/**
 * Per-seat fares for the selected seats. A seat-specific quote must cover
 * exactly these seats and its fares must add up to the quote total. A
 * count-only quote (some OTA flows) cannot know seat premiums → the caller
 * must re-price for the chosen seats.
 */
export function resolveSeatFares(
  quote: { seatFares: { seatNumber: string; totalMinor: number }[]; totalMinor: number },
  seatNumbers: string[],
): SeatFareResolution {
  if (!quote.seatFares || quote.seatFares.length === 0) return { kind: 'needs_seat_quote' };
  const fareBySeat = new Map(quote.seatFares.map((f) => [normaliseSeat(f.seatNumber), f.totalMinor]));
  const chosen = seatNumbers.map(normaliseSeat);
  const mismatch = chosen.filter((s) => !fareBySeat.has(s));
  if (mismatch.length || fareBySeat.size !== chosen.length) {
    throw new HoldValidationError(`The price quote was for seats ${[...fareBySeat.keys()].join(', ')}, not ${chosen.join(', ')} — please refresh the price`);
  }
  const sum = [...fareBySeat.values()].reduce((a, b) => a + b, 0);
  if (sum !== quote.totalMinor) throw new HoldValidationError('Price quote is inconsistent — please refresh the price');
  return { kind: 'priced', fareBySeat };
}

/** Equal split, remainder on the first seat — ONLY for a re-priced quote whose seats all cost the same. */
export function equalSplit(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];
  const each = Math.floor(totalMinor / count);
  return Array.from({ length: count }, (_, i) => each + (i === 0 ? totalMinor - each * count : 0));
}
