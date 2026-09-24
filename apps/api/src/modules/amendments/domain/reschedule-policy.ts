import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

/**
 * ============================================================================
 *  Reschedule policy — what it costs to change a booking's date/trip
 * ============================================================================
 *
 * Rescheduling ("date change") is distinct from cancel-and-rebook: the seat
 * moves to the new trip in one operation, and the passenger pays only the
 * DIFFERENCE plus a reschedule fee — they do NOT lose the original fare to a
 * cancellation slab. This is a major retention feature and a common source of
 * accounting bugs, so the money math is pure and exhaustively tested.
 *
 * The charge is:
 *   fareDifference   = newFare − originalFare   (can be negative = credit)
 *   rescheduleFee    = tiered by hours-to-departure (like cancellation)
 *   amountDue        = max(0, fareDifference) + rescheduleFee
 *   refundDue        = max(0, −fareDifference − rescheduleFee)   (rare: cheaper new trip)
 *
 * Operators cap how many times a ticket may be rescheduled and forbid it too
 * close to departure — both enforced here.
 */

export interface RescheduleTier {
  minHoursBeforeDeparture: number;
  feeMinor: number;
}

export interface ReschedulePolicy {
  tiers: RescheduleTier[];
  /** Not allowed within this many hours of the ORIGINAL departure. */
  cutoffHours: number;
  /** Max times a single booking may be rescheduled. */
  maxReschedules: number;
}

export const DEFAULT_RESCHEDULE_POLICY: ReschedulePolicy = {
  tiers: [
    { minHoursBeforeDeparture: 24, feeMinor: 5000 },   // ₹50
    { minHoursBeforeDeparture: 6, feeMinor: 10000 },   // ₹100
    { minHoursBeforeDeparture: 2, feeMinor: 15000 },   // ₹150
  ],
  cutoffHours: 2,
  maxReschedules: 2,
};

export interface RescheduleQuote {
  allowed: boolean;
  fareDifferenceMinor: number;
  feeMinor: number;
  amountDueMinor: number;
  refundDueMinor: number;
  reason: string;
}

export function quoteReschedule(input: {
  originalFareMinor: number;
  newFareMinor: number;
  originalDepartureAt: Date;
  now: Date;
  timesRescheduled: number;
  policy?: ReschedulePolicy;
  currency?: CurrencyCode;
}): RescheduleQuote {
  const policy = input.policy ?? DEFAULT_RESCHEDULE_POLICY;
  const currency = input.currency ?? 'INR';
  if (input.originalFareMinor < 0 || input.newFareMinor < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Fares cannot be negative');
  }

  const hoursToDeparture = (input.originalDepartureAt.getTime() - input.now.getTime()) / 3_600_000;

  if (input.timesRescheduled >= policy.maxReschedules) {
    return deny(currency, `This ticket has already been rescheduled ${policy.maxReschedules} time(s)`);
  }
  if (hoursToDeparture < policy.cutoffHours) {
    return deny(currency, `Rescheduling is not permitted within ${policy.cutoffHours}h of departure`);
  }

  const tier = [...policy.tiers]
    .sort((a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture)
    .find((t) => hoursToDeparture >= t.minHoursBeforeDeparture);
  // Below the lowest tier threshold but above cutoff → highest fee tier applies.
  const feeMinor = tier?.feeMinor ?? policy.tiers[policy.tiers.length - 1]?.feeMinor ?? 0;

  const fareDifference = input.newFareMinor - input.originalFareMinor;
  const fee = Money.of(feeMinor, currency);
  const diff = Money.of(fareDifference, currency);

  // Net position: the fee always adds to what the passenger owes, the fare
  // difference adds (pricier) or subtracts (cheaper). A single `net` avoids
  // double-counting the fee — a positive net is payable, a negative net is
  // refundable, and they are mutually exclusive.
  const net = diff.plus(fee);
  const amountDue = Money.max(net, Money.zero(currency));
  const refundDue = Money.max(net.negate(), Money.zero(currency));

  return {
    allowed: true,
    fareDifferenceMinor: fareDifference,
    feeMinor,
    amountDueMinor: amountDue.minor,
    refundDueMinor: refundDue.minor,
    reason: fareDifference >= 0
      ? `Pay fare difference ${diff.format()} + reschedule fee ${fee.format()}`
      : `New trip is cheaper; ${refundDue.isPositive() ? `refund ${refundDue.format()}` : `fee ${fee.format()} applies`}`,
  };
}

function deny(_currency: CurrencyCode, reason: string): RescheduleQuote {
  return { allowed: false, fareDifferenceMinor: 0, feeMinor: 0, amountDueMinor: 0, refundDueMinor: 0, reason };
}
