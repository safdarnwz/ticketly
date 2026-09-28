/**
 * Who may sit next to whom (the usual "for female" / "for male"
 * seats). Two seats are neighbours when they are on the same deck, share a
 * row, and touch side by side — no aisle between them. A double sleeper berth
 * pair and the two seats of a 2+2 row are neighbours; seats across the aisle,
 * or one behind the other, are not.
 *
 * The operator chooses the rule: 'off' (anyone anywhere), 'women' (the seat
 * beside a woman is for a woman) or 'both' (and the seat beside a man is for a
 * man). A seat beside both a woman and a man is kept for a woman.
 */
export const ADJACENT_SEAT_RULES = ['off', 'women', 'both'] as const;
export type AdjacentSeatRule = (typeof ADJACENT_SEAT_RULES)[number];
export type Gender = 'female' | 'male';

export interface PlacedSeat {
  seatNumber: string;
  deck: number;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
}

/** Seats that sit side by side with `seat` (same deck, overlapping rows, touching columns). */
export function neighboursOf(seat: PlacedSeat, all: PlacedSeat[]): PlacedSeat[] {
  return all.filter(
    (o) =>
      o.seatNumber !== seat.seatNumber &&
      o.deck === seat.deck &&
      o.row < seat.row + seat.rowSpan &&
      seat.row < o.row + o.rowSpan &&
      (o.column + o.colSpan === seat.column || seat.column + seat.colSpan === o.column),
  );
}

/**
 * For every seat not taken, who it is kept for under the rule, given the
 * gender of the traveller on each taken seat. Seats with no restriction are
 * left out of the map.
 */
export function reservedSeats(
  rule: AdjacentSeatRule,
  seats: PlacedSeat[],
  takenBy: ReadonlyMap<string, Gender | null>,
): Map<string, Gender> {
  const out = new Map<string, Gender>();
  if (rule === 'off') return out;
  for (const seat of seats) {
    if (takenBy.has(seat.seatNumber)) continue;
    const beside = neighboursOf(seat, seats).map((n) => takenBy.get(n.seatNumber) ?? null);
    if (beside.includes('female')) out.set(seat.seatNumber, 'female');
    else if (rule === 'both' && beside.includes('male')) out.set(seat.seatNumber, 'male');
  }
  return out;
}

/**
 * The passengers of one booking that break the rule, as messages: a man on a
 * seat kept for a woman, a woman on a seat kept for a man, or anyone whose
 * gender is not given on a kept seat. Seats of the same booking do not bind
 * each other (a couple books the pair together).
 */
export function neighbourProblems(
  rule: AdjacentSeatRule,
  seats: PlacedSeat[],
  takenBy: ReadonlyMap<string, Gender | null>,
  passengers: { seatNumber: string; fullName?: string; gender?: string | null }[],
): string[] {
  const kept = reservedSeats(rule, seats, takenBy);
  const problems: string[] = [];
  for (const p of passengers) {
    const want = kept.get(p.seatNumber);
    if (!want || p.gender === want) continue;
    const who = p.fullName ? `${p.fullName} (seat ${p.seatNumber})` : `Seat ${p.seatNumber}`;
    problems.push(
      p.gender
        ? `${who}: this seat is next to a ${want === 'female' ? 'woman' : 'man'} traveller and is kept for ${want === 'female' ? 'women' : 'men'} — please choose another seat`
        : `${who}: this seat is kept for ${want === 'female' ? 'women' : 'men'} — tell us the passenger's gender or choose another seat`,
    );
  }
  return problems;
}
