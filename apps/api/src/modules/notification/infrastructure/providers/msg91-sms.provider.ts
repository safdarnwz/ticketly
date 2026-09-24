import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { Logger } from '@observability';

import { IntegrationCredentialStore } from '../../../integrations/integration-credential.store';
import type { NotificationProvider, SendRequest, SendResult } from '../provider.interface';

/**
 * MSG91 SMS — India-focused SMS gateway.
 *
 * Uses the "Send SMS v2" campaign endpoint, which (unlike the newer DLT Flow
 * API) accepts a fully-rendered message body directly — matching how this
 * codebase already works (NotificationService renders the tenant's template
 * to a final string before handing it to a provider). In production India
 * traffic, the rendered text must still match a DLT-registered template
 * pattern — that's a one-time MSG91-dashboard registration step, not
 * something this code enforces.
 *
 * Docs (verify against MSG91's current reference when wiring the real key —
 * their API has changed shape a few times):
 *   POST https://api.msg91.com/api/v2/sendsms
 *   Header: authkey
 *   Body: { sender, route, country, sms: [{ message, to: [msisdn] }] }
 *
 * `country` is hardcoded to '91' (India) since MSG91's core business is
 * India-only routes; international SMS needs a different MSG91 product.
 *
 * Credentials: the platform admin's saved `msg91_sms` integration wins when
 * it is enabled (#16); otherwise the MSG91_* environment variables are used.
 */
@Injectable()
export class Msg91SmsProvider implements NotificationProvider {
  readonly channel = 'sms' as const;
  readonly name = 'msg91_sms';
  private readonly log: Logger;

  constructor(
    private readonly config: AppConfig,
    private readonly credentials: IntegrationCredentialStore,
    logger: Logger,
  ) {
    this.log = logger.forContext('Msg91Sms');
  }

  /** True when either the saved integration or the env vars can send. */
  isConfigured(): boolean {
    return this.credentials.active('msg91_sms') !== null || this.config.notifications.msg91.enabled;
  }

  private settings(): { authKey: string; senderId: string; route: string } {
    const saved = this.credentials.active('msg91_sms');
    if (saved) return { authKey: saved.secrets.authKey, senderId: saved.config.senderId, route: saved.config.route };
    const { msg91 } = this.config.notifications;
    return { authKey: msg91.authKey, senderId: msg91.senderId, route: msg91.route };
  }

  async send(req: SendRequest): Promise<SendResult> {
    const msg91 = this.settings();
    const mobile = normaliseIndianMobile(req.recipient);
    if (!mobile) return { ok: false, error: `Not a valid Indian mobile number: ${req.recipient}` };

    try {
      const res = await fetch('https://api.msg91.com/api/v2/sendsms', {
        method: 'POST',
        headers: { authkey: msg91.authKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: msg91.senderId,
          route: msg91.route,
          country: '91',
          sms: [{ message: req.body, to: [mobile] }],
        }),
      });
      const json = (await res.json().catch(() => null)) as { type?: string; message?: string } | null;
      if (!res.ok || json?.type === 'error') {
        const error = json?.message ?? `HTTP ${res.status}`;
        this.log.warn({ to: mobile, error }, 'MSG91 SMS send failed');
        return { ok: false, error };
      }
      return { ok: true, providerRef: json?.message ?? undefined };
    } catch (err) {
      this.log.error({ err, to: mobile }, 'MSG91 SMS request threw');
      return { ok: false, error: err instanceof Error ? err.message : 'network error' };
    }
  }
}

/** MSG91 wants a bare 91-prefixed MSISDN, e.g. "919876543210" — no '+', no spaces. */
export function normaliseIndianMobile(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return `91${digits.slice(3)}`;
  return null;
}
