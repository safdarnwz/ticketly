import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { WebhookAudienceRegistry } from './application/webhook-audience.registry';
import { WebhookDeliveryService } from './application/webhook-delivery.service';
import { WebhookRepository } from './infrastructure/webhook.repository';
import { WebhookController } from './presentation/webhook.controller';

/**
 * Outbound, signed event webhooks — for operators' own endpoints and for GDS
 * partners (GDS registers a WebhookAudienceResolver). The worker imports this
 * module to deliver events and retry failures.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [WebhookController],
  providers: [WebhookRepository, WebhookDeliveryService, WebhookAudienceRegistry],
  exports: [WebhookRepository, WebhookDeliveryService, WebhookAudienceRegistry],
})
export class WebhooksModule {}
