import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { DepartureControlController } from './presentation/departure-control.controller';
import { DepartureControlRepository } from './infrastructure/persistence/departure-control.repository';
import { DepartureControlService } from './application/services/departure-control.service';

/**
 * Departure control (Part 13). At departure a trip is "charted": the live seat
 * position (confirmed vs boarded → no-shows, vacant) is reconciled with the
 * conductor's declared spot sales and cash, and written as an immutable
 * closeout record. Pure reconciliation logic lives in domain/.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [DepartureControlController],
  providers: [DepartureControlRepository, DepartureControlService],
  exports: [DepartureControlService],
})
export class DepartureControlModule {}
