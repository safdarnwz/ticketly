import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { PlanQuotaService } from './application/plan-quota.service';
import { PlanQuotaRepository } from './infrastructure/plan-quota.repository';

/**
 * Plan quotas. Standalone (database only) so fleet, master data, branches,
 * agents and IAM can all check a quota without importing TenancyModule.
 */
@Module({
  imports: [DatabaseModule],
  providers: [PlanQuotaRepository, PlanQuotaService],
  exports: [PlanQuotaService],
})
export class EntitlementsModule {}
