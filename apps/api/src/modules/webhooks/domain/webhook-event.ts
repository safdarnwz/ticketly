import { createHmac } from 'node:crypto';

/**
 * The events a webhook endpoint can subscribe to — the public webhook
 * contract. An endpoint with an empty subscription list receives all of them.
 */
export const WebhookEvent = {
  BOOKING_CONFIRMED: 'booking.confirmed',
  BOOKING_CANCELLED: 'booking.cancelled',
  TRIP_DELAYED: 'trip.delayed',
  TRIP_DEPARTED: 'trip.departed',
  PAYMENT_CAPTURED: 'payment.captured',
  REFUND_SETTLED: 'refund.settled',
} as const;

export type WebhookEventType = (typeof WebhookEvent)[keyof typeof WebhookEvent];
export const WEBHOOK_EVENTS: readonly WebhookEventType[] = Object.values(WebhookEvent);

/** Sent by "test delivery" — never a real event. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export const WEBHOOK_SIGNATURE_HEADER = 'X-Ticketly-Signature';

/** `sha256=<hex>` where hex = HMAC_SHA256(endpoint secret, raw JSON body). */
export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Minutes until the next attempt after `attemptsSoFar` failures; null = give up (5 attempts total). */
export function nextRetryMinutes(attemptsSoFar: number): number | null {
  return [1, 5, 30, 180][attemptsSoFar] ?? null;
}
