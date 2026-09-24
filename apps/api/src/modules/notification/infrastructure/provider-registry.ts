import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

import { EmailNotificationProvider } from './providers/email.provider';
import { LogProviderFactory } from './providers/log.provider';
import { Msg91SmsProvider } from './providers/msg91-sms.provider';
import { Msg91WhatsAppProvider } from './providers/msg91-whatsapp.provider';
import type { Channel, NotificationProvider } from './provider.interface';

/**
 * Picks the REAL provider for a channel once it's configured, and falls back
 * to `LogProviderFactory` otherwise — so a fresh clone with no API keys still
 * runs the full event → template → deliver pipeline end-to-end (just logged),
 * and flipping to production is purely an env-var change, no code change or
 * redeploy-with-different-code.
 *
 * `push` (mobile app notifications) has no real provider yet — there's no
 * mobile app in this codebase to receive them (FCM/APNs need a registered
 * device token from a client app). It always logs until one exists.
 */
@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly config: AppConfig,
    private readonly log: LogProviderFactory,
    private readonly sms: Msg91SmsProvider,
    private readonly whatsapp: Msg91WhatsAppProvider,
    private readonly email: EmailNotificationProvider,
  ) {}

  forChannel(channel: Channel): NotificationProvider {
    switch (channel) {
      case 'sms':
        return this.config.notifications.msg91.enabled ? this.sms : this.log.forChannel(channel);
      case 'whatsapp':
        return this.config.notifications.msg91.enabled && this.config.notifications.msg91.whatsappIntegratedNumber
          ? this.whatsapp
          : this.log.forChannel(channel);
      case 'email':
        // EmailNotificationProvider always "works" — Mailer itself degrades to
        // logging when Gmail creds are absent — so it's always the real path.
        return this.email;
      case 'push':
      default:
        return this.log.forChannel(channel);
    }
  }
}
