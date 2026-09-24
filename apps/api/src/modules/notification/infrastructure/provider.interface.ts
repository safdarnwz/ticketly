/**
 * Notification channel provider abstraction.
 *
 * SMS (via a gateway like MSG91/Twilio), Email (SES/SendGrid), WhatsApp (Cloud
 * API) and Push (FCM/APNs) all "send a message to a recipient" behind different
 * APIs. This interface is the seam: the notification service picks a provider by
 * channel; adding a provider is one adapter. Every adapter returns a provider
 * reference for the delivery log and never throws for a soft failure (it returns
 * `{ ok: false }` so the outbox retry logic — not an exception — governs retry).
 */
export type Channel = 'sms' | 'email' | 'whatsapp' | 'push';

export interface SendRequest {
  channel: Channel;
  recipient: string;
  subject?: string;
  body: string;
  /** Email only — the operator's own brand name to show as the sender, instead of the platform's. See Mailer's own doc comment for why only the display name (not the address) varies per-tenant. */
  fromName?: string;
}

export interface SendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
}

export interface NotificationProvider {
  readonly channel: Channel;
  /** For the delivery-log's `provider` column — 'log' for the dev fallback, otherwise the real gateway's name. */
  readonly name: string;
  send(req: SendRequest): Promise<SendResult>;
}

export const NOTIFICATION_PROVIDERS = Symbol('NOTIFICATION_PROVIDERS');
