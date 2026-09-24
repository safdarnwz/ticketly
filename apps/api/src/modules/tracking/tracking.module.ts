import { Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { TrackingController } from './presentation/tracking.controller';
import { TrackingService } from './application/services/tracking.service';

@Module({
  imports: [ConfigModule, DatabaseModule, MessagingModule],
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
