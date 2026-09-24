import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { SchedulingModule } from '../scheduling/scheduling.module';
import { SeatQuotaService } from './application/seat-quota.service';
import { SeatQuotaRepository } from './infrastructure/seat-quota.repository';
import { SeatQuotaController } from './presentation/seat-quota.controller';

/** Seat allocations (quotas) for agents and branches. */
@Module({
  imports: [DatabaseModule, SchedulingModule],
  controllers: [SeatQuotaController],
  providers: [SeatQuotaRepository, SeatQuotaService],
  exports: [SeatQuotaService],
})
export class QuotasModule {}
