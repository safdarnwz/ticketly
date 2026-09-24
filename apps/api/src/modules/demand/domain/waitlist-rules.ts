/**
 * Waitlist — pure rules.
 *
 * A passenger joins only when the segment is actually full. When seats free
 * up (a cancellation), entries are notified FIRST-COME-FIRST-SERVED, and only
 * as many as the freed seats can satisfy (an entry for 3 seats is skipped —
 * not blocking the queue — when only 2 are free). A notification is not a
 * reservation: whoever books first gets the seat.
 */
export const WAITLIST_MAX_SEATS = 6;
export const WAITLIST_MAX_PER_TRIP = 100;
export const WAITLIST_CUTOFF_MINUTES = 60;

export class WaitlistRuleError extends Error {
  constructor(message: string) { super(message); this.name = 'WaitlistRuleError'; }
}

export function validateJoin(input: {
  seatCount: number; availableSeats: number; tripStatus: string; departsAt: Date; waitingCount: number; now?: Date;
}): void {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.seatCount) || input.seatCount < 1 || input.seatCount > WAITLIST_MAX_SEATS) {
    throw new WaitlistRuleError(`You can wait for 1 to ${WAITLIST_MAX_SEATS} seats`);
  }
  if (!['scheduled', 'open'].includes(input.tripStatus)) throw new WaitlistRuleError('This trip is not open for booking');
  if (input.departsAt.getTime() - now.getTime() < WAITLIST_CUTOFF_MINUTES * 60_000) throw new WaitlistRuleError('The waitlist closes an hour before departure');
  if (input.availableSeats >= input.seatCount) throw new WaitlistRuleError(`${input.availableSeats} seat(s) are available right now — book them directly`);
  if (input.waitingCount >= WAITLIST_MAX_PER_TRIP) throw new WaitlistRuleError('The waitlist for this trip is full');
}

export interface WaitingEntry { id: string; seatCount: number; availableForSegment: number }

/**
 * Which entries to notify, oldest first. `availableForSegment` is the free
 * seat count for that entry's own segment; each notified entry "uses up" its
 * seats from the budget so we never notify more people than seats exist.
 */
export function pickToNotify(entries: WaitingEntry[]): string[] {
  // One shared budget across all entries: conservative when entries are for
  // different segments (may under-notify), but it can never over-notify.
  let consumed = 0;
  const out: string[] = [];
  for (const e of entries) {
    const remaining = e.availableForSegment - consumed;
    if (e.seatCount <= remaining) {
      out.push(e.id);
      consumed += e.seatCount;
    }
  }
  return out;
}
