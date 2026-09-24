import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Refund clawback split
 * ============================================================================
 *
 * When a (possibly partial) refund is paid, the money must be reversed out of
 * the SAME accounts it was booked into, in the SAME proportion — otherwise the
 * ledger drifts. Given what a booking captured (the operator's share — fare +
 * ticket GST — the platform's commission, and GST on that commission), this
 * computes how much of a refund is clawed back from each so that:
 *
 *    commissionClawback + commissionGstClawback + operatorClawback === refundMinor   (always)
 *
 * which is exactly what makes the `refund.paid` ledger entry balance. The split
 * is proportional to the original shares; rounding is absorbed into the
 * operator leg so all three always foot to the refund to the paisa.
 */
export interface CapturedSplit {
  commissionMinor: number;
  commissionGstMinor: number;
  operatorShareMinor: number;
}

export interface RefundClawback {
  commissionClawbackMinor: number;
  commissionGstClawbackMinor: number;
  operatorClawbackMinor: number;
}

export function splitRefundClawback(captured: CapturedSplit, refundMinor: number): RefundClawback {
  if (refundMinor < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Refund amount cannot be negative');
  }
  const totalCaptured =
    captured.commissionMinor + captured.commissionGstMinor + captured.operatorShareMinor;
  if (refundMinor > totalCaptured) {
    throw new DomainError(ErrorCode.REFUND_NOT_ALLOWED, 'Refund exceeds the captured amount', {
      details: { refundMinor, totalCaptured },
    });
  }

  let commissionClawback = 0;
  let commissionGstClawback = 0;
  if (totalCaptured > 0) {
    commissionClawback = Math.round((captured.commissionMinor * refundMinor) / totalCaptured);
    commissionGstClawback = Math.round((captured.commissionGstMinor * refundMinor) / totalCaptured);
  }
  // Never claw back more than the refund itself between the two platform legs.
  if (commissionClawback + commissionGstClawback > refundMinor) {
    commissionGstClawback = Math.max(0, refundMinor - commissionClawback);
  }
  const operatorClawback = refundMinor - commissionClawback - commissionGstClawback;

  return {
    commissionClawbackMinor: commissionClawback,
    commissionGstClawbackMinor: commissionGstClawback,
    operatorClawbackMinor: operatorClawback,
  };
}

/**
 * Commission to claw back when part of a B2B sale (operator agent or GDS
 * partner) is refunded — the same
 * proportion of the commission as the refund is of the amount paid, so a
 * full refund reverses all of it and the seller never keeps commission on a
 * ticket that was not ultimately sold. Never more than was credited.
 */
export function commissionClawbackMinor(input: {
  commissionCreditedMinor: number;
  refundMinor: number;
  paidMinor: number;
}): number {
  if (input.commissionCreditedMinor <= 0 || input.refundMinor <= 0 || input.paidMinor <= 0)
    return 0;
  if (input.refundMinor >= input.paidMinor) return input.commissionCreditedMinor;
  return Math.min(
    input.commissionCreditedMinor,
    Math.round((input.commissionCreditedMinor * input.refundMinor) / input.paidMinor),
  );
}
