import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { ReviewController } from './presentation/review.controller';
import { ReviewRepository } from './infrastructure/persistence/review.repository';
import { ReviewService } from './application/services/review.service';

/**
 * Reviews & ratings (Part 14). Verified-traveller reviews (one per booking),
 * aggregated with a Bayesian ranking score so a handful of 5★ don't outrank a
 * high-volume 4.7★. Pure aggregation logic lives in domain/.
 */
@Module({
  imports: [DatabaseModule, BookingModule],
  controllers: [ReviewController],
  providers: [ReviewRepository, ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
