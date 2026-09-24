import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { TrackingController } from './presentation/tracking.controller';
import { TrackingService } from './application/services/tracking.service';
import { TrackingRepository } from './infrastructure/persistence/tracking.repository';

@Module({
  imports: [ConfigModule, DatabaseModule, MessagingModule],
  controllers: [TrackingController],
  providers: [TrackingRepository, TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
