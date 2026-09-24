import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';

import { BookingModule } from '../booking/booking.module';
import { ReportingController } from './presentation/reporting.controller';
import { ReportingService } from './application/services/reporting.service';
import { ReportRepository } from './infrastructure/persistence/report.repository';

@Module({
  imports: [ConfigModule, DatabaseModule, BookingModule],
  controllers: [ReportingController],
  providers: [ReportRepository, ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
