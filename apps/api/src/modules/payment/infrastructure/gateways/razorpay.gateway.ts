import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { Logger } from '@observability';

import { PaymentGateway } from './gateway.interface';
import type {
  CreateIntentRequest, CreateIntentResult, RefundRequest, RefundResult, WebhookVerification,
} from './gateway.interface';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

/**
 * Razorpay — the real PSP adapter.
 *
 * Implements the exact same contract as MockGateway (createIntent →
 * verifyWebhook → refund), so no booking/payment code needed to change to
 * plug this in — see PaymentModule's factory, which picks this over
 * MockGateway once `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are set.
 *
 * Docs (verify against Razorpay's current reference if something 404s — API
 * paths are stable but response shapes occasionally gain fields):
 *   Orders:   https://razorpay.com/docs/api/orders/
 *   Webhooks: https://razorpay.com/docs/webhooks/
 *   Refunds:  https://razorpay.com/docs/api/refunds/
 *
 * IMPORTANT — three DIFFERENT secrets are involved and must not be confused:
 *   - key_id / key_secret: authenticate OUR server calls TO Razorpay (Basic auth).
 *   - webhook_secret: verifies calls FROM Razorpay TO us (a separate secret,
 *     set once when the webhook endpoint is registered in the Razorpay
 *     dashboard — NOT the same value as key_secret).
 */
@Injectable()
export class RazorpayGateway extends PaymentGateway {
  readonly name = 'razorpay';
  private readonly log: Logger;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;

  constructor(config: AppConfig, logger: Logger) {
    super();
    this.log = logger.forContext('RazorpayGateway');
    this.keyId = config.payment.razorpay.keyId;
    this.keySecret = config.payment.razorpay.keySecret;
    this.webhookSecret = config.payment.razorpay.webhookSecret;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  async createIntent(req: CreateIntentRequest): Promise<CreateIntentResult> {
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: { Authorization: this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: req.amountMinor, // Razorpay wants the smallest unit too (paise for INR) — matches our minor-unit convention directly.
        currency: req.currency,
        receipt: req.intentId, // OUR id, round-tripped for reconciliation — this is what makes retries traceable, not auto-deduped by Razorpay itself.
        notes: { bookingId: req.bookingId, intentId: req.intentId },
        payment_capture: 1, // auto-capture on success — we don't do a separate manual-capture step.
      }),
    });
    const json = (await res.json()) as { id?: string; amount?: number; currency?: string; status?: string; error?: { description?: string } };
    if (!res.ok || !json.id) {
      this.log.error({ status: res.status, error: json.error }, 'Razorpay order creation failed');
      throw new Error(`Razorpay order creation failed: ${json.error?.description ?? `HTTP ${res.status}`}`);
    }
    return {
      gatewayOrderId: json.id,
      // Shape the Razorpay Checkout.js SDK expects on the client — see
      // https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
      clientPayload: {
        key: this.keyId,
        order_id: json.id,
        amount: req.amountMinor,
        currency: req.currency,
        name: 'Ticketly',
        prefill: { contact: req.customerPhone, email: req.customerEmail },
      },
      status: 'created',
    };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    const provided = headers['x-razorpay-signature'] ?? '';
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (!provided || a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'signature mismatch' };
    }

    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as {
        event: string;
        payload: {
          payment?: { entity: { id: string; order_id: string; amount: number; status: string; notes?: { intentId?: string } } };
          refund?: { entity: { id: string; payment_id: string; amount: number; status: string } };
        };
      };

      if (payload.event.startsWith('payment.') && payload.payload.payment) {
        const p = payload.payload.payment.entity;
        return {
          valid: true,
          event: {
            type: payload.event,
            gatewayOrderId: p.order_id,
            gatewayPaymentId: p.id,
            intentId: p.notes?.intentId,
            amountMinor: p.amount,
            status: mapRazorpayStatus(p.status),
          },
        };
      }
      if (payload.event.startsWith('refund.') && payload.payload.refund) {
        const r = payload.payload.refund.entity;
        return {
          valid: true,
          event: {
            type: payload.event,
            gatewayOrderId: '', // refunds aren't keyed by order in Razorpay's payload
            gatewayPaymentId: r.payment_id,
            gatewayRefundId: r.id,
            refundOutcome: payload.event === 'refund.failed' || r.status === 'failed' ? 'failed' : 'processed',
            amountMinor: r.amount,
            status: 'refunded',
          },
        };
      }
      return { valid: false, reason: `unhandled event type: ${payload.event}` };
    } catch {
      return { valid: false, reason: 'malformed payload' };
    }
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const res = await fetch(`${RAZORPAY_API}/payments/${req.gatewayPaymentId}/refund`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Content-Type': 'application/json',
        // Razorpay's idempotency key — a retried refund request with the SAME
        // key returns the original result instead of double-refunding.
        'X-Razorpay-Idempotency': req.refundId,
      },
      body: JSON.stringify({ amount: req.amountMinor, receipt: req.refundId }),
    });
    const json = (await res.json()) as { id?: string; status?: string; error?: { description?: string } };
    if (!res.ok || !json.id) {
      this.log.error({ status: res.status, error: json.error }, 'Razorpay refund failed');
      throw new Error(`Razorpay refund failed: ${json.error?.description ?? `HTTP ${res.status}`}`);
    }
    return {
      gatewayRefundId: json.id,
      status: json.status === 'processed' ? 'processed' : json.status === 'failed' ? 'failed' : 'processing',
    };
  }

  override verifyClientCallback(payload: Record<string, string>): { valid: boolean; gatewayOrderId?: string; gatewayPaymentId?: string; reason?: string } {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = payload;
    if (!orderId || !paymentId || !signature) return { valid: false, reason: 'missing razorpay_order_id/payment_id/signature' };

    // Razorpay's documented post-checkout verification formula — DIFFERENT
    // from the webhook signature above (that one signs the whole webhook
    // body with webhook_secret; this one signs "order_id|payment_id" with
    // key_secret). https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/#3-verify-the-payment-signature
    const expected = createHmac('sha256', this.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'signature mismatch' };

    return { valid: true, gatewayOrderId: orderId, gatewayPaymentId: paymentId };
  }
}

function mapRazorpayStatus(s: string): 'created' | 'authorized' | 'captured' | 'failed' | 'refunded' {
  if (s === 'captured' || s === 'authorized' || s === 'failed' || s === 'refunded') return s;
  return 'created';
}
