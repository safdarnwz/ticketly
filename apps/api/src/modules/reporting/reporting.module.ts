import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { ReportingController } from './presentation/reporting.controller';
import { ReportingService } from './application/services/reporting.service';

@Module({
  imports: [DatabaseModule, BookingModule],
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
