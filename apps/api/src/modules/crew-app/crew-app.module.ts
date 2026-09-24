import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { CrewAppController } from './presentation/crew-app.controller';
import { CrewAppService } from './application/services/crew-app.service';
import { BookingModule } from '../booking/booking.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [DatabaseModule, MessagingModule, BookingModule, SchedulingModule],
  controllers: [CrewAppController],
  providers: [CrewAppService],
  exports: [CrewAppService],
})
export class CrewAppModule {}
