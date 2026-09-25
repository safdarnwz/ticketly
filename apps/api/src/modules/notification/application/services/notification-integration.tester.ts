import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  IntegrationCredentialStore,
  IntegrationTesterRegistry,
  type IntegrationProvider,
  type IntegrationTestResult,
  type IntegrationTester,
} from '../../../integrations';
import { Mailer } from '../../infrastructure/mail/mailer';
import { Msg91SmsProvider } from '../../infrastructure/providers/msg91-sms.provider';
import { Msg91WhatsAppProvider } from '../../infrastructure/providers/msg91-whatsapp.provider';

const TEST_BODY = 'Ticketly test message: your gateway settings work.';

/** Test sends for the messaging integrations (#19 SMS, #20 WhatsApp, #21 email). */
@Injectable()
export class NotificationIntegrationTester implements IntegrationTester, OnModuleInit {
  readonly providers = ['msg91_sms', 'msg91_whatsapp', 'smtp'] as const;

  constructor(
    private readonly registry: IntegrationTesterRegistry,
    private readonly credentials: IntegrationCredentialStore,
    private readonly sms: Msg91SmsProvider,
    private readonly whatsapp: Msg91WhatsAppProvider,
    private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async test(
    provider: IntegrationProvider,
    to: string | undefined,
  ): Promise<IntegrationTestResult> {
    if (!to) return { ok: false, error: 'Give a recipient ("to") for the test message' };
    switch (provider) {
      case 'msg91_sms': {
        const saved = await this.credentials.stored('msg91_sms');
        if (!saved) return notSaved;
        return this.sms.sendWith(
          {
            authKey: saved.secrets.authKey,
            senderId: saved.config.senderId,
            route: saved.config.route,
          },
          { channel: 'sms', recipient: to, body: TEST_BODY },
        );
      }
      case 'msg91_whatsapp': {
        const saved = await this.credentials.stored('msg91_whatsapp');
        if (!saved) return notSaved;
        return this.whatsapp.sendWith(
          {
            authKey: saved.secrets.authKey,
            whatsappIntegratedNumber: saved.config.integratedNumber,
          },
          { channel: 'whatsapp', recipient: to, body: TEST_BODY },
        );
      }
      case 'smtp': {
        const saved = await this.credentials.stored('smtp');
        if (!saved) return notSaved;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
          return { ok: false, error: 'Not an email address' };
        await this.mailer.sendTest(
          { ...saved.config, password: saved.secrets.password },
          { to, subject: 'Ticketly test email', text: TEST_BODY },
        );
        return { ok: true };
      }
      default:
        return { ok: false, error: `No test for ${provider}` };
    }
  }
}

const notSaved: IntegrationTestResult = { ok: false, error: 'No saved credentials' };
