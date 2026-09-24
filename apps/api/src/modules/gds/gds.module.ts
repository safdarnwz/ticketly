import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SearchModule } from '../search/search.module';
import { RefundModule } from '../refunds/refund.module';
import { GdsRepository } from './infrastructure/gds.repository';
import { GdsRefundService } from './application/gds-refund.service';
import { GdsService } from './application/gds.service';
import {
  GdsAdminController,
  GdsOperatorController,
  GdsPartnerController,
} from './presentation/gds.controllers';
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
  ],
  controllers: [GdsPartnerController, GdsAdminController, GdsOperatorController],
  providers: [GdsService, GdsPartnerGuard, GdsRepository, GdsRefundService],
})
export class GdsModule {}
