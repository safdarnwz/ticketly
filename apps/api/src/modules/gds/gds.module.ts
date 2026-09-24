import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SearchModule } from '../search/search.module';
import { RefundModule } from '../refunds/refund.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { GdsWebhookAudience } from './application/gds-webhook-audience';
import { GdsRepository } from './infrastructure/gds.repository';
import { GdsRefundService } from './application/gds-refund.service';
import { GdsService } from './application/gds.service';
import { GdsAdminController } from './presentation/gds-admin.controller';
import { GdsOperatorController } from './presentation/gds-operator.controller';
import { GdsPartnerController } from './presentation/gds-partner.controller';
import { GdsPartnerGuard } from './presentation/gds-partner.guard';

/** Platform GDS: one partner integration → every participating operator. */
@Module({
  imports: [
    DatabaseModule,
    SearchModule,
    PricingModule,
    BookingModule,
    PaymentModule,
    SchedulingModule,
    RefundModule,
    WebhooksModule,
  ],
  controllers: [GdsPartnerController, GdsAdminController, GdsOperatorController],
  providers: [GdsService, GdsPartnerGuard, GdsRepository, GdsRefundService, GdsWebhookAudience],
})
export class GdsModule {}
