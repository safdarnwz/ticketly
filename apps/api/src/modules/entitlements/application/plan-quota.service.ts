import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, requireTenantId } from '@kernel';

import { quotaExceeded, type QuotaKey } from '../domain/plan-quotas';
import { PlanQuotaRepository } from '../infrastructure/plan-quota.repository';

/**
 * Enforces plan quotas. The owning module counts its own records (it knows
 * what "active" means for a branch or an agent) and asks before adding one.
 */
@Injectable()
export class PlanQuotaService {
  constructor(private readonly quotas: PlanQuotaRepository) {}

  /** 403 TENANT.QUOTA_EXCEEDED when the plan allows no more of `key`. */
  async assertCanAdd(key: QuotaKey, currentCount: number, label: string): Promise<void> {
    const limit = quotaExceeded(await this.quotas.quotasFor(requireTenantId()), key, currentCount);
    if (limit !== null)
      throw new AppError(ErrorCode.TENANT_QUOTA_EXCEEDED, 403, {
        message: `Your plan allows ${limit} ${label} — upgrade your plan to add more`,
        details: { quota: key, limit, current: currentCount },
      });
  }
}
