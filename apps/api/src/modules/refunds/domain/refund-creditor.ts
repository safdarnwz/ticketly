import type { BookingId, TenantId } from '@kernel';

/**
 * A refund for a sale that was NOT paid through the platform's own PSP is
 * credited to the seller's account instead (an operator's B2B agent, or a GDS
 * partner). Each selling channel owns its account ledger, so it registers a
 * creditor with the refunds module rather than the refunds module importing
 * every channel.
 */
export interface RefundCreditInput {
  bookingId: BookingId;
  refundId: string;
  refundMinor: number;
  tenantId: TenantId;
}

export interface RefundCreditor {
  /** The `payment_intents.gateway` value of sales this creditor owns (e.g. 'agent', 'gds'). */
  readonly gateway: string;
  /**
   * Who held the sale money, which decides the refund's ledger posting:
   *  - 'operator'  — the operator collected it offline (agent sale): only the
   *    platform's commission share is reversed;
   *  - 'platform'  — the platform captured it from the partner's account (GDS
   *    sale): the full refund is posted and the partner's commission share is
   *    given back to the operator.
   */
  readonly collectedBy: 'operator' | 'platform';
  /** `refund.settled` destination label. */
  readonly destination: string;
  /** Metrics channel label. */
  readonly channel: string;
  /** Failure reason recorded when the booking has no account to credit. */
  readonly missingAccountReason: string;
  /** Credit the refund (inside the caller's transaction). null = no account owns this booking. */
  creditRefund(input: RefundCreditInput): Promise<{ clawbackMinor: number } | null>;
}
