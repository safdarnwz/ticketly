import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SearchModule } from '../search/search.module';
import { GdsService } from './application/gds.service';
import { GdsLedgerModule } from './gds-ledger.module';
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
    GdsLedgerModule,
  ],
  controllers: [GdsPartnerController, GdsAdminController, GdsOperatorController],
  providers: [GdsService, GdsPartnerGuard],
})
export class GdsModule {}
