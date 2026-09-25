import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { BookingModule } from '../booking/booking.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AmendmentService } from './application/services/amendment.service';
import { AmendmentRepository } from './infrastructure/persistence/amendment.repository';
import { AmendmentsController } from './presentation/amendments.controller';
import { PaymentModule } from '../payment/payment.module';
import { RescheduleCapture } from './application/services/reschedule.capture';

/**
 * Booking amendments — reschedule (date/trip change) and seat change. Reuses the
 * booking module's SeatLock gate so an amendment gets the same anti-double-sell
 * guarantee as a fresh booking, and pricing for the fare-difference math.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    BookingModule,
    MasterDataModule,
    PaymentModule,
    PricingModule,
    SchedulingModule,
  ],
  controllers: [AmendmentsController],
  providers: [AmendmentRepository, AmendmentService, RescheduleCapture],
  exports: [AmendmentService],
})
export class AmendmentsModule {}
