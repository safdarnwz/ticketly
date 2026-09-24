import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

import { PaymentGateway } from './gateway.interface';
import type {
  CreateIntentRequest, CreateIntentResult, RefundRequest, RefundResult, WebhookVerification,
} from './gateway.interface';

/**
 * Reference gateway adapter.
 *
 * Implements the full contract — including **HMAC-SHA256 signature verification
 * over the raw webhook body**, exactly as Razorpay/PayU do — against a
 * deterministic local "PSP", so the entire payment flow (intent → webhook →
 * capture → refund) is testable end-to-end without a real provider. A
 * production adapter (RazorpayGateway, PayuGateway) swaps the HTTP calls and the
 * provider's exact signature scheme; the shape stays identical.
 *
 * The signature scheme mirrors the industry norm:
 *   signature = HMAC_SHA256(secret, rawBody)   compared in constant time.
 */
@Injectable()
export class MockGateway extends PaymentGateway {
  readonly name: string = 'mock';
  private readonly secret: string;

  constructor(config: AppConfig) {
    super();
    // In production each PSP has its own webhook secret from config/secrets.
    this.secret = config.security.jwtSecret; // reuse a strong secret for the demo adapter
  }

  async createIntent(req: CreateIntentRequest): Promise<CreateIntentResult> {
    // Deterministic order id derived from our intent id → idempotent by design.
    const gatewayOrderId = `mock_order_${req.intentId}`;
    return {
      gatewayOrderId,
      clientPayload: { orderId: gatewayOrderId, amount: req.amountMinor, currency: req.currency, key: 'mock_key' },
      status: 'created',
    };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    const provided = headers['x-webhook-signature'] ?? headers['x-razorpay-signature'] ?? '';
    const expected = createHmac('sha256', this.secret).update(rawBody).digest('hex');

    // Constant-time compare; unequal lengths fail without leaking timing.
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'signature mismatch' };
    }

    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as {
        type: string; order_id: string; payment_id: string; intent_id?: string; amount: number; status: string;
      };
      return {
        valid: true,
        event: {
          type: payload.type,
          gatewayOrderId: payload.order_id,
          gatewayPaymentId: payload.payment_id,
          intentId: payload.intent_id,
          amountMinor: payload.amount,
          status: payload.status as never,
        },
      };
    } catch {
      return { valid: false, reason: 'malformed payload' };
    }
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    return { gatewayRefundId: `mock_rfnd_${req.refundId}`, status: 'processed' };
  }

  /** Test helper: sign a payload the way the "PSP" would. */
  sign(rawBody: Buffer): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }
}
