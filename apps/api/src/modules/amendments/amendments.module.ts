import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { BookingModule } from '../booking/booking.module';
import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AmendmentService } from './application/services/amendment.service';
import { AmendmentsController } from './presentation/amendments.controller';

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
    PricingModule,
    SchedulingModule,
  ],
  controllers: [AmendmentsController],
  providers: [AmendmentService],
  exports: [AmendmentService],
})
export class AmendmentsModule {}
