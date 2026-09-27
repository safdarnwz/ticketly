import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

/**
 * ============================================================================
 *  Cancellation refund policy — time-to-departure tiers
 * ============================================================================
 *
 * When a passenger cancels, how much do they get back? Every operator publishes
 * a tiered policy keyed on how long before departure the cancellation happens:
 * the earlier you cancel, the more you get. A typical policy:
 *
 *   > 24h before departure : 90% refund (10% fee)
 *   6h – 24h              : 75% refund
 *   2h – 6h               : 50% refund
 *   < 2h / after departure : 0% refund
 *
 * This is pure, money-exact logic (integer minor units), so a refund is always
 * reproducible and auditable — a passenger dispute is settled by re-running it,
 * not by arguing. The policy itself is data (an operator config), not code, so
 * each operator sets its own tiers; this engine just applies them correctly.
 */

export interface RefundTier {
  /** Applies when hours-to-departure is >= this threshold. */
  minHoursBeforeDeparture: number;
  /** Percentage of the paid amount refunded, 0..100. */
  refundPct: number;
}

export interface RefundPolicy {
  /** Tiers, evaluated highest-threshold first. */
  tiers: RefundTier[];
  /** A flat per-ticket cancellation fee deducted on top, in minor units. */
  flatFeeMinor?: number;
  /** Cancellation not allowed at all within this many hours (0 = always allowed). */
  cutoffHours?: number;
  /**
   * May customers, agents and partners cancel only some seats of a booking?
   * Off = whole bookings only (staff at the counter can still do it). Default on.
   */
  partialCancellation?: boolean;
  /**
   * Minutes after the departure time before staff may mark a passenger a
   * no-show (a late passenger may still be picked up on the way). Default 0.
   */
  noShowGraceMinutes?: number;
  /**
   * Free cancellation window: cancelled within this many hours of paying, the
   * whole amount comes back (no tier cut, no fee) — still subject to the
   * cutoff near departure. 0 / absent = no free window.
   */
  freeCancellationHours?: number;
}

/** A sensible default if an operator hasn't configured one. */
export const DEFAULT_REFUND_POLICY: RefundPolicy = {
  tiers: [
    { minHoursBeforeDeparture: 24, refundPct: 90 },
    { minHoursBeforeDeparture: 6, refundPct: 75 },
    { minHoursBeforeDeparture: 2, refundPct: 50 },
    { minHoursBeforeDeparture: 0, refundPct: 0 },
  ],
  flatFeeMinor: 0,
};

export interface RefundComputation {
  refundable: boolean;
  refundPct: number;
  paid: Money;
  fee: Money;
  refund: Money;
  reason: string;
}

/**
 * Compute the refund for a cancellation.
 *
 * @param paidMinor    what the passenger actually paid (minor units)
 * @param departureAt  the trip's departure instant
 * @param now          the moment of cancellation
 */
export function computeRefund(
  paidMinor: number,
  departureAt: Date,
  now: Date,
  policy: RefundPolicy = DEFAULT_REFUND_POLICY,
  currency: CurrencyCode = 'INR',
  /** When the booking was paid for — for the free cancellation window. */
  confirmedAt?: Date | null,
): RefundComputation {
  if (paidMinor < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Paid amount cannot be negative');
  }
  const paid = Money.of(paidMinor, currency);
  const hoursToDeparture = (departureAt.getTime() - now.getTime()) / 3_600_000;

  // Hard cutoff — some operators forbid cancellation close to departure.
  if (policy.cutoffHours && hoursToDeparture < policy.cutoffHours) {
    return {
      refundable: false,
      refundPct: 0,
      paid,
      fee: Money.zero(currency),
      refund: Money.zero(currency),
      reason: `Cancellation not permitted within ${policy.cutoffHours}h of departure`,
    };
  }

  // Within the free cancellation window after paying: everything back.
  const freeHours = policy.freeCancellationHours ?? 0;
  if (
    freeHours > 0 &&
    confirmedAt &&
    now.getTime() >= confirmedAt.getTime() &&
    now.getTime() - confirmedAt.getTime() <= freeHours * 3_600_000
  ) {
    return {
      refundable: paid.isPositive(),
      refundPct: 100,
      paid,
      fee: Money.zero(currency),
      refund: paid,
      reason: `Free cancellation within ${freeHours}h of booking — full refund`,
    };
  }

  // Highest tier whose threshold is satisfied wins.
  const tier = [...policy.tiers]
    .sort((a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture)
    .find((t) => hoursToDeparture >= t.minHoursBeforeDeparture);

  const refundPct = tier?.refundPct ?? 0;
  let refund = paid.percent(refundPct);

  // Apply the flat fee, never letting the refund go negative.
  const fee = Money.of(policy.flatFeeMinor ?? 0, currency);
  refund = refund.minus(fee).clampZero();

  return {
    refundable: refund.isPositive(),
    refundPct,
    paid,
    fee,
    refund,
    reason:
      refundPct === 0
        ? 'No refund at this time before departure'
        : `${refundPct}% refund${fee.isPositive() ? ` less a ${fee.format()} fee` : ''}`,
  };
}
