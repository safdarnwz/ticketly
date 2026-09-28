/**
 * ============================================================================
 *  Seat quotas & phone holds — pure timing / eligibility rules
 * ============================================================================
 *
 * SEAT QUOTA: an operator reserves specific seats of a trip for ONE agent or
 * branch (a seat allocation). Nobody else can sell them. At
 * `departs_at - releaseMinutesBefore` any unsold quota seat returns to general
 * sale automatically, so reserved inventory never departs empty.
 *
 * PHONE HOLD: staff keep seats for a caller who pays later (payment link or at
 * a branch). The seats are released automatically at the chosen time.
 */
export const QUOTA_MIN_RELEASE_MINUTES = 30; // released at least 30 min before departure
export const QUOTA_MAX_RELEASE_MINUTES = 7 * 24 * 60; // at most 7 days before departure
export const PHONE_HOLD_MIN_MINUTES = 5;
export const PHONE_HOLD_MAX_HOURS = 72;
export const PHONE_HOLD_DEPARTURE_BUFFER_MINUTES = 60;
export const MAX_QUOTA_SEATS_PER_CALL = 60;

export type QuotaHolderType = 'agent' | 'branch';

export class QuotaRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaRuleError';
  }
}

export function quotaReleaseAt(departsAt: Date, releaseMinutesBefore: number): Date {
  return new Date(departsAt.getTime() - releaseMinutesBefore * 60_000);
}

/** Validate a new allocation. `now` injectable for tests. */
export function validateQuotaAllocation(input: {
  seatNumbers: string[];
  releaseMinutesBefore: number;
  tripStatus: string;
  departsAt: Date;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  const seats = input.seatNumbers.map((s) => String(s ?? '').trim());
  if (seats.length === 0) throw new QuotaRuleError('Select at least one seat');
  if (seats.length > MAX_QUOTA_SEATS_PER_CALL)
    throw new QuotaRuleError(`At most ${MAX_QUOTA_SEATS_PER_CALL} seats per allocation`);
  if (seats.some((s) => s === '')) throw new QuotaRuleError('Seat numbers cannot be blank');
  const dup = seats.find((s, i) => seats.indexOf(s) !== i);
  if (dup) throw new QuotaRuleError(`Seat ${dup} was selected more than once`);
  if (!['scheduled', 'open'].includes(input.tripStatus))
    throw new QuotaRuleError(`Cannot allocate seats on a ${input.tripStatus} trip`);
  if (!Number.isInteger(input.releaseMinutesBefore))
    throw new QuotaRuleError('Release time must be whole minutes');
  if (
    input.releaseMinutesBefore < QUOTA_MIN_RELEASE_MINUTES ||
    input.releaseMinutesBefore > QUOTA_MAX_RELEASE_MINUTES
  ) {
    throw new QuotaRuleError(
      `Release time must be between ${QUOTA_MIN_RELEASE_MINUTES} minutes and ${QUOTA_MAX_RELEASE_MINUTES / 1440} days before departure`,
    );
  }
  if (quotaReleaseAt(input.departsAt, input.releaseMinutesBefore) <= now) {
    throw new QuotaRuleError(
      'That release time has already passed for this trip — choose a shorter release window',
    );
  }
}

/** A quota seat is usable by its holder only until its release instant. */
export function isQuotaUsable(
  q: { releasedAt: Date | null; consumedAt: Date | null; releaseAt: Date },
  now: Date = new Date(),
): boolean {
  return q.releasedAt === null && q.consumedAt === null && q.releaseAt > now;
}

/** Validate the "hold until" chosen for a phone booking. */
export function validatePhoneHoldUntil(
  holdUntil: Date,
  departsAt: Date,
  now: Date = new Date(),
): void {
  if (Number.isNaN(holdUntil.getTime()))
    throw new QuotaRuleError('Release time is not a valid date/time');
  if (holdUntil.getTime() < now.getTime() + PHONE_HOLD_MIN_MINUTES * 60_000) {
    throw new QuotaRuleError(
      `Release time must be at least ${PHONE_HOLD_MIN_MINUTES} minutes from now`,
    );
  }
  if (holdUntil.getTime() > now.getTime() + PHONE_HOLD_MAX_HOURS * 3_600_000) {
    throw new QuotaRuleError(
      `A phone booking can be held for at most ${PHONE_HOLD_MAX_HOURS} hours`,
    );
  }
  if (holdUntil.getTime() > departsAt.getTime() - PHONE_HOLD_DEPARTURE_BUFFER_MINUTES * 60_000) {
    throw new QuotaRuleError(
      `Release time must be at least ${PHONE_HOLD_DEPARTURE_BUFFER_MINUTES} minutes before departure`,
    );
  }
}
