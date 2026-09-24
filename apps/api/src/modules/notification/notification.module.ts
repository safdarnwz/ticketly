import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { ObservabilityModule } from '@observability';

import { Mailer } from './infrastructure/mail/mailer';
import { IntegrationsModule } from '../integrations/integrations.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { NotificationController } from './presentation/notification.controller';
import { NotificationTemplateRepository } from './infrastructure/persistence/notification-template.repository';
import { NotificationService } from './application/services/notification.service';
import { ProviderRegistry } from './infrastructure/provider-registry';
import { EmailNotificationProvider } from './infrastructure/providers/email.provider';
import { LogProviderFactory } from './infrastructure/providers/log.provider';
import { Msg91SmsProvider } from './infrastructure/providers/msg91-sms.provider';
import { Msg91WhatsAppProvider } from './infrastructure/providers/msg91-whatsapp.provider';

/**
 * Notification engine. Provided so both the API (template management) and the
 * worker (the NotificationHandler that reacts to events) can use it.
 *
 * `Mailer` is re-provided here (not imported via IamModule) to keep the
 * module graph acyclic — same pattern TenancyModule uses for the IAM
 * repositories it needs. It's a stateless, dependency-light class (just
 * `Logger` + two env vars), so constructing it in two module scopes is
 * harmless. `PlatformSettingsModule` (not `TenancyModule`) for the same
 * cycle-avoidance reason documented there — this module is imported into
 * many places (including the worker), so the lightest-possible dependency
 * matters more here than almost anywhere else.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ObservabilityModule,
    PlatformSettingsModule,
    IntegrationsModule,
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationTemplateRepository,
    ProviderRegistry,
    LogProviderFactory,
    Msg91SmsProvider,
    Msg91WhatsAppProvider,
    EmailNotificationProvider,
    Mailer,
  ],
  exports: [NotificationService, Mailer],
})
export class NotificationModule {}
