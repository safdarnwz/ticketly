/**
 * ============================================================================
 *  Payment gateway abstraction
 * ============================================================================
 *
 * The platform integrates multiple PSPs (Razorpay, PayU, Cashfree, Stripe…).
 * All of them do the same three things — create an order, verify a callback,
 * issue a refund — behind wildly different APIs and signature schemes. This
 * interface is the seam: the booking/payment flow speaks ONLY to
 * `PaymentGateway`, and each PSP is a small adapter. Adding a PSP is one new
 * adapter file; no booking code changes.
 *
 * IDEMPOTENCY & SECURITY are contract requirements of every adapter:
 *  - `createIntent` must be idempotent on our `intentId` (never create two PSP
 *    orders for one intent).
 *  - `verifyWebhook` must validate the PSP's signature over the RAW body — the
 *    single most important control in payments. A webhook whose signature does
 *    not verify is discarded; we NEVER trust an unsigned "payment succeeded".
 */

export type PaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export interface CreateIntentRequest {
  intentId: string; // our id — the idempotency key at the PSP
  amountMinor: number;
  currency: string;
  bookingId: string;
  customerEmail?: string;
  customerPhone?: string;
  /** Where the PSP redirects / calls back. */
  callbackUrl: string;
}

export interface CreateIntentResult {
  gatewayOrderId: string;
  /** Opaque data the client SDK needs to open the PSP checkout. */
  clientPayload: Record<string, unknown>;
  status: PaymentStatus;
}

export interface WebhookVerification {
  valid: boolean;
  /** Parsed, trusted event once the signature verified. */
  event?: {
    type: string; // 'payment.captured' | 'payment.failed' | 'refund.processed'
    gatewayOrderId: string;
    gatewayPaymentId: string;
    intentId?: string;
    amountMinor: number;
    status: PaymentStatus;
    /** refund.* events only — the PSP's refund id (our refunds are looked up by it). */
    gatewayRefundId?: string;
    /** refund.* events only. */
    refundOutcome?: 'processed' | 'failed';
  };
  reason?: string;
}

/**
 * Dedupe key for a webhook: the SAME payment id legitimately arrives as
 * several different events (payment.authorized → payment.captured →
 * refund.processed ...). Keying on the payment id alone swallowed every
 * event after the first as a "duplicate".
 */
export function webhookDedupeKey(event: {
  type: string;
  gatewayPaymentId: string;
  gatewayRefundId?: string;
}): string {
  return `${event.type}:${event.gatewayRefundId ?? event.gatewayPaymentId}`;
}

export interface RefundRequest {
  gatewayPaymentId: string;
  amountMinor: number;
  /** Our refund id — idempotency key at the PSP. */
  refundId: string;
}

export interface RefundResult {
  gatewayRefundId: string;
  status: 'processing' | 'processed' | 'failed';
}

/**
 * Abstract class (not an interface) so it doubles as the Nest DI token and can
 * be injected BY TYPE — `private readonly gateway: PaymentGateway` — with no
 * `@Inject(Symbol)` parameter decorator (which the esbuild/tsx dev transpiler
 * does not always emit correct metadata for).
 */
export abstract class PaymentGateway {
  abstract readonly name: string;
  abstract createIntent(req: CreateIntentRequest): Promise<CreateIntentResult>;
  /** Verify the signature over the raw body, then parse. */
  abstract verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification;
  abstract refund(req: RefundRequest): Promise<RefundResult>;

  /**
   * Verify the CLIENT-side checkout success callback (e.g. Razorpay
   * Checkout.js's `handler`), so the UI can move on the instant payment
   * succeeds rather than waiting for the async webhook — the webhook still
   * runs too and is what's actually authoritative (this is a UX shortcut,
   * not a replacement; `BookingService.confirm` is idempotent either way).
   * Default: not supported (the sandbox gateways have no such client step).
   */
  verifyClientCallback(_payload: Record<string, string>): {
    valid: boolean;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    reason?: string;
  } {
    return { valid: false, reason: `${this.name} does not support client-side verification` };
  }
}
