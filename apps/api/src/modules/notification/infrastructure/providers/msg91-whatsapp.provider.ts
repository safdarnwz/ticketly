import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { Logger } from '@observability';

import { IntegrationCredentialStore } from '../../../integrations';
import { normaliseIndianMobile } from './msg91-sms.provider';
import type { NotificationProvider, SendRequest, SendResult } from '../provider.interface';

/**
 * MSG91 WhatsApp — sends via a WhatsApp Business number integrated with MSG91.
 *
 * Docs (verify against MSG91's current reference when wiring the real key):
 *   POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/
 *   Header: authkey
 *   Body: { integrated_number, content_type: 'text', payload: { to, type: 'text', text: { body } } }
 *
 * A plain free-text message like this only works within WhatsApp's 24-hour
 * customer-service window (i.e. the customer messaged the operator's WhatsApp
 * number recently). Outside that window — which is the common case for a
 * booking confirmation the customer never initiated — WhatsApp REQUIRES a
 * pre-approved template message instead of free text. That template
 * registration (through MSG91's dashboard + Meta's approval) is a one-time
 * business step, not something this code can do; this provider covers the
 * within-window / already-templated-text case. Swap `content_type`/`payload`
 * to MSG91's template shape once a template is approved, if needed.
 *
 * Credentials: the saved `msg91_whatsapp` integration wins when enabled
 * (#17); otherwise the MSG91_* environment variables are used.
 */
@Injectable()
export class Msg91WhatsAppProvider implements NotificationProvider {
  readonly channel = 'whatsapp' as const;
  readonly name = 'msg91_whatsapp';
  private readonly log: Logger;

  constructor(
    private readonly config: AppConfig,
    private readonly credentials: IntegrationCredentialStore,
    logger: Logger,
  ) {
    this.log = logger.forContext('Msg91WhatsApp');
  }

  isConfigured(): boolean {
    const { msg91 } = this.config.notifications;
    return (
      this.credentials.active('msg91_whatsapp') !== null ||
      (msg91.enabled && msg91.whatsappIntegratedNumber.length > 0)
    );
  }

  private settings(): { authKey: string; whatsappIntegratedNumber: string } {
    const saved = this.credentials.active('msg91_whatsapp');
    if (saved)
      return {
        authKey: saved.secrets.authKey,
        whatsappIntegratedNumber: saved.config.integratedNumber,
      };
    const { msg91 } = this.config.notifications;
    return { authKey: msg91.authKey, whatsappIntegratedNumber: msg91.whatsappIntegratedNumber };
  }

  async send(req: SendRequest): Promise<SendResult> {
    return this.sendWith(this.settings(), req);
  }

  /** Send with the given (possibly not yet enabled) credentials — the admin "test WhatsApp" (#20). */
  async sendWith(
    msg91: { authKey: string; whatsappIntegratedNumber: string },
    req: SendRequest,
  ): Promise<SendResult> {
    const mobile = normaliseIndianMobile(req.recipient);
    if (!mobile) return { ok: false, error: `Not a valid Indian mobile number: ${req.recipient}` };

    try {
      const res = await fetch('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/', {
        method: 'POST',
        headers: { authkey: msg91.authKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrated_number: msg91.whatsappIntegratedNumber,
          content_type: 'text',
          payload: { to: mobile, type: 'text', text: { body: req.body } },
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        message?: string;
        request_id?: string;
      } | null;
      if (!res.ok) {
        const error = json?.message ?? `HTTP ${res.status}`;
        this.log.warn({ to: mobile, error }, 'MSG91 WhatsApp send failed');
        return { ok: false, error };
      }
      return { ok: true, providerRef: json?.request_id };
    } catch (err) {
      this.log.error({ err, to: mobile }, 'MSG91 WhatsApp request threw');
      return { ok: false, error: err instanceof Error ? err.message : 'network error' };
    }
  }
}
