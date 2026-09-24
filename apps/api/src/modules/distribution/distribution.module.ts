import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { PaymentModule } from '../payment/payment.module';
import { PricingModule } from '../pricing/pricing.module';
import { SearchModule } from '../search/search.module';
import { DistributionController } from './presentation/distribution.controller';
import { WebhookDeliveryService } from './application/services/webhook-delivery.service';
import { WebhookRepository } from './infrastructure/webhook.repository';

/**
 * OTA distribution. A thin adapter over the first-party services — partners
 * share the exact same inventory, pricing and anti-double-sell guarantees with
 * no separate code path. Imports PaymentModule so partner confirmations post
 * the exact same ledger entry (commission/payable/tax) a direct online
 * payment does — see PaymentService.confirmPartnerBooking; this used to call
 * BookingService.confirm directly, which flips the booking to 'confirmed'
 * but posts NO ledger entry at all, making every OTA-channel booking an
 * accounting blind spot.
 */
@Module({
  imports: [DatabaseModule, SearchModule, PricingModule, BookingModule, PaymentModule],
  controllers: [DistributionController],
  providers: [WebhookRepository, WebhookDeliveryService],
  exports: [WebhookRepository, WebhookDeliveryService],
})
export class DistributionModule {}
