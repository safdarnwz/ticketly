import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { DemandService } from './application/demand.service';
import { DemandRepository } from './infrastructure/demand.repository';
import { DemandController } from './presentation/demand.controller';

/** Waitlist on full trips + occupancy forecasting. */
@Module({
  imports: [DatabaseModule, MessagingModule],
  controllers: [DemandController],
  providers: [DemandService, DemandRepository],
  exports: [DemandService],
})
export class DemandModule {}
