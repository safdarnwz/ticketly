import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, NotFoundError, type BranchId } from '@kernel';

import { PlanQuotaService, QUOTA_KEYS } from '../../entitlements';
import { workingHoursErrors, type WorkingHours } from '../domain/working-hours';
import { BranchRepository } from '../infrastructure/persistence/branch.repository';

/** Operator branches / counters: plan quota (#103), opening hours (#129), status. */
@Injectable()
export class BranchService {
  constructor(
    private readonly branches: BranchRepository,
    private readonly quotas: PlanQuotaService,
  ) {}

  async create(input: {
    name: string;
    address?: string;
    phone?: string;
    managerUserId?: string;
    workingHours?: WorkingHours;
  }): Promise<BranchId> {
    await this.quotas.assertCanAdd(
      QUOTA_KEYS.branches,
      await this.branches.countActive(),
      'branches',
    );
    if (input.workingHours) assertHours(input.workingHours);
    return this.branches.create(input);
  }

  async update(
    id: BranchId,
    input: {
      name?: string;
      address?: string;
      phone?: string;
      managerUserId?: string;
      workingHours?: WorkingHours;
    },
  ): Promise<void> {
    if (input.workingHours) assertHours(input.workingHours);
    if (!(await this.branches.update(id, input))) throw new NotFoundError('Branch', id);
  }

  async deactivate(id: BranchId): Promise<void> {
    if (!(await this.branches.setStatus(id, 'inactive'))) throw new NotFoundError('Branch', id);
  }

  /** Reactivating counts against the plan's branch limit like a new branch. */
  async activate(id: BranchId): Promise<void> {
    const branch = await this.branches.find(id);
    if (!branch) throw new NotFoundError('Branch', id);
    if (branch.status === 'active') return;
    await this.quotas.assertCanAdd(
      QUOTA_KEYS.branches,
      await this.branches.countActive(),
      'branches',
    );
    await this.branches.setStatus(id, 'active');
  }
}

function assertHours(hours: WorkingHours): void {
  const errors = workingHoursErrors(hours);
  if (errors.length > 0)
    throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: errors.join('; ') });
}
