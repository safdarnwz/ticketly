/**
 * Waitlist — pure rules.
 *
 * A passenger joins only when the segment is actually full. When seats free
 * up (a cancellation), entries are notified FIRST-COME-FIRST-SERVED, and only
 * as many as the freed seats can satisfy (an entry for 3 seats is skipped —
 * not blocking the queue — when only 2 are free). A notification is not a
 * reservation: whoever books first gets the seat.
 */
/** An operator's waitlist rules (#237, #239); the platform default until it sets its own. */
export interface WaitlistRules {
  /** At most this many people wait for one trip. */
  maxPerTrip: number;
  /** One entry waits for at most this many seats. */
  maxSeatsPerEntry: number;
  /** The waitlist closes this many minutes before departure. */
  closeMinutesBefore: number;
  /** A waiting entry lapses this many hours after joining (null = waits until departure). */
  entryExpiryHours: number | null;
}

export const DEFAULT_WAITLIST_RULES: WaitlistRules = {
  maxPerTrip: 100,
  maxSeatsPerEntry: 6,
  closeMinutesBefore: 60,
  entryExpiryHours: null,
};

/** The operator's stored rules over the defaults (a missing or bad field keeps its default). */
export function waitlistRules(stored: unknown): WaitlistRules {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<
    Record<keyof WaitlistRules, unknown>
  >;
  const int = (v: unknown, min: number, max: number, dflt: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : dflt;
  return {
    maxPerTrip: int(s.maxPerTrip, 1, 500, DEFAULT_WAITLIST_RULES.maxPerTrip),
    maxSeatsPerEntry: int(s.maxSeatsPerEntry, 1, 10, DEFAULT_WAITLIST_RULES.maxSeatsPerEntry),
    closeMinutesBefore: int(
      s.closeMinutesBefore,
      0,
      1440,
      DEFAULT_WAITLIST_RULES.closeMinutesBefore,
    ),
    entryExpiryHours:
      typeof s.entryExpiryHours === 'number' &&
      Number.isInteger(s.entryExpiryHours) &&
      s.entryExpiryHours >= 1 &&
      s.entryExpiryHours <= 720
        ? s.entryExpiryHours
        : null,
  };
}

export class WaitlistRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaitlistRuleError';
  }
}

export function validateJoin(input: {
  seatCount: number;
  availableSeats: number;
  tripStatus: string;
  departsAt: Date;
  waitingCount: number;
  now?: Date;
  rules?: WaitlistRules;
}): void {
  const now = input.now ?? new Date();
  const rules = input.rules ?? DEFAULT_WAITLIST_RULES;
  if (
    !Number.isInteger(input.seatCount) ||
    input.seatCount < 1 ||
    input.seatCount > rules.maxSeatsPerEntry
  ) {
    throw new WaitlistRuleError(`You can wait for 1 to ${rules.maxSeatsPerEntry} seats`);
  }
  if (!['scheduled', 'open'].includes(input.tripStatus))
    throw new WaitlistRuleError('This trip is not open for booking');
  if (!isWaitlistOpen(input.departsAt, now, rules))
    throw new WaitlistRuleError(
      `The waitlist closes ${closeText(rules.closeMinutesBefore)} before departure`,
    );
  if (input.availableSeats >= input.seatCount)
    throw new WaitlistRuleError(
      `${input.availableSeats} seat(s) are available right now — book them directly`,
    );
  if (input.waitingCount >= rules.maxPerTrip)
    throw new WaitlistRuleError('The waitlist for this trip is full');
}

/** Still taking (and notifying) entries this close to departure? */
export function isWaitlistOpen(departsAt: Date, now: Date, rules: WaitlistRules): boolean {
  return departsAt.getTime() - now.getTime() >= rules.closeMinutesBefore * 60_000;
}

function closeText(minutes: number): string {
  if (minutes === 0) return 'at';
  if (minutes % 60 === 0) return minutes === 60 ? 'an hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export interface WaitingEntry {
  id: string;
  seatCount: number;
  availableForSegment: number;
}

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
