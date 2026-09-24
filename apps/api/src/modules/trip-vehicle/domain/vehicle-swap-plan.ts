/**
 * ============================================================================
 *  Bus change on a trip — pure seat re-mapping plan
 * ============================================================================
 *
 * Every IN-USE seat of the trip (sold on any segment, blocked, or allocated
 * to an agent/branch quota) must land on a seat of the new bus:
 *   1. same seat number, same seat type, bookable  → stays where it is;
 *   2. otherwise → the first free bookable seat of the SAME TYPE on the new
 *      bus (natural seat order), so every passenger keeps the class they
 *      paid for (sleeper stays sleeper);
 *   3. no such seat → a blocker; the swap is refused and nothing changes.
 * A seat's whole bitmap moves together, so segment sales sharing one seat
 * (A→B for one passenger, B→C for another) always travel together.
 * Ladies-only: a seat is never moved INTO a ladies-only seat — a passenger's
 * gender is not re-validated here, so we never risk placing a man there.
 */
export interface CurrentSeat {
  seatNumber: string;
  seatType: string;
  occupied: bigint;
  blocked: bigint;
  ladiesOnly: boolean;
}
export interface LayoutSeat {
  number: string;
  type: string;
  bookable: boolean;
  ladiesOnly: boolean;
}

export interface SeatMove {
  from: string;
  to: string;
  seatType: string;
}
export interface VehicleSwapPlan {
  newSeats: {
    seatNumber: string;
    seatType: string;
    bookable: boolean;
    ladiesOnly: boolean;
    occupied: bigint;
    blocked: bigint;
  }[];
  kept: string[];
  moves: SeatMove[];
  blockers: string[];
}

const natural = (a: string, b: string) =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

export function planVehicleSwap(current: CurrentSeat[], layout: LayoutSeat[]): VehicleSwapPlan {
  const inUse = current
    .filter((s) => s.occupied !== 0n || s.blocked !== 0n)
    .sort((a, b) => natural(a.seatNumber, b.seatNumber));
  const byNumber = new Map(layout.map((l) => [l.number, l]));
  const taken = new Set<string>();
  const target = new Map<string, CurrentSeat>(); // new seat number → carried old seat
  const kept: string[] = [];
  const moves: SeatMove[] = [];
  const blockers: string[] = [];

  // Pass 1: seats that can stay put (so they are not "stolen" by a move in pass 2).
  const needMove: CurrentSeat[] = [];
  for (const s of inUse) {
    const same = byNumber.get(s.seatNumber);
    if (same && same.bookable && same.type === s.seatType && (!same.ladiesOnly || s.ladiesOnly)) {
      taken.add(same.number);
      target.set(same.number, s);
      kept.push(s.seatNumber);
    } else {
      needMove.push(s);
    }
  }
  // Pass 2: move the rest to the first free seat of the same type.
  const free = layout
    .filter((l) => l.bookable && !l.ladiesOnly)
    .sort((a, b) => natural(a.number, b.number));
  for (const s of needMove) {
    const dest = free.find((l) => !taken.has(l.number) && l.type === s.seatType);
    if (!dest) {
      blockers.push(`${s.seatNumber} (${s.seatType})`);
      continue;
    }
    taken.add(dest.number);
    target.set(dest.number, s);
    moves.push({ from: s.seatNumber, to: dest.number, seatType: s.seatType });
  }

  const newSeats = layout.map((l) => {
    const carried = target.get(l.number);
    return {
      seatNumber: l.number,
      seatType: l.type,
      bookable: l.bookable,
      ladiesOnly: l.ladiesOnly,
      occupied: carried?.occupied ?? 0n,
      blocked: carried?.blocked ?? 0n,
    };
  });
  return { newSeats, kept, moves, blockers };
}

/** Two trips conflict if their time windows (with a turnaround buffer) overlap. */
export function windowsOverlap(
  a: { departsAt: Date; arrivesAt: Date },
  b: { departsAt: Date; arrivesAt: Date },
  bufferMinutes = 30,
): boolean {
  const pad = bufferMinutes * 60_000;
  return (
    a.departsAt.getTime() - pad < b.arrivesAt.getTime() &&
    b.departsAt.getTime() - pad < a.arrivesAt.getTime()
  );
}
