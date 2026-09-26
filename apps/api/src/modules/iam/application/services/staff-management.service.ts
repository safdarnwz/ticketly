import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  getUserId,
  requireTenantId,
  type UserId,
} from '@kernel';

import { AuditService } from './audit.service';
import { UserService } from './user.service';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { StaffDirectoryRepository } from '../../infrastructure/persistence/staff-directory.repository';
import type { StaffImportRow } from '../../domain/staff-import';

const invalid = (message: string) => new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });

/**
 * Running a team: upload many staff at once (212), daily sales targets (356)
 * and written warnings (388). Each uploaded row stands alone — one bad row
 * never stops the others — and uploading the same file twice adds nobody twice.
 */
@Injectable()
export class StaffManagementService {
  constructor(
    private readonly users: UserService,
    private readonly roles: RoleRepository,
    private readonly staff: StaffDirectoryRepository,
    private readonly audit: AuditService,
    private readonly uow: UnitOfWork,
  ) {}

  /** `rows` in file order; a row the schema already rejected carries its `error`. */
  async bulkInvite(rows: (StaffImportRow | { error: string })[]): Promise<{
    imported: number;
    failed: { row: number; error: string }[];
    created: { row: number; fullName: string; email: string; password: string }[];
  }> {
    const roles = await this.roles.list();
    const failed: { row: number; error: string }[] = [];
    const created: { row: number; fullName: string; email: string; password: string }[] = [];
    const seenEmail = new Set<string>();
    const seenPhone = new Set<string>();
    for (const [i, r] of rows.entries()) {
      const row = i + 1;
      try {
        if ('error' in r) throw new Error(r.error);
        if (seenEmail.has(r.email)) throw new Error('Same email as an earlier row');
        if (r.phone && seenPhone.has(r.phone)) throw new Error('Same mobile as an earlier row');
        seenEmail.add(r.email);
        if (r.phone) seenPhone.add(r.phone);
        const wanted = r.role.trim().toLowerCase();
        const role = roles.find((x) => x.code === wanted || x.name.toLowerCase() === wanted);
        if (!role) throw new Error(`No role called "${r.role}"`);
        let branchId: string | null = null;
        if (r.branch) {
          branchId = await this.staff.activeBranchIdByName(r.branch);
          if (!branchId) throw new Error(`No active branch called "${r.branch}"`);
        }
        const password = startingPassword();
        const id = await this.users.invite({
          fullName: r.fullName,
          email: r.email,
          phone: r.phone,
          password,
          roles: [role.code],
        });
        if (branchId) await this.users.setBranch(id, branchId);
        created.push({ row, fullName: r.fullName, email: r.email, password });
      } catch (e) {
        failed.push({ row, error: e instanceof Error ? e.message : 'Could not add' });
      }
    }
    return { imported: created.length, failed, created };
  }

  private async activePerson(userId: string, action: string) {
    const person = await this.staff.find(userId);
    if (!person) throw new NotFoundError('User', userId);
    if (person.status !== 'active') throw invalid(`Enable the account before you ${action}`);
    return person;
  }

  async setTarget(
    userId: string,
    target: { dailyBookings: number; dailyRevenueMinor: number | null } | null,
  ): Promise<void> {
    if (target) await this.activePerson(userId, 'set a target');
    else if (!(await this.staff.find(userId))) throw new NotFoundError('User', userId);
    await this.uow.run({ name: 'staff.setTarget', tenantId: requireTenantId() }, async () => {
      await this.staff.setTarget(userId, target);
      await this.audit.recordInTx({
        action: target ? 'user.target_set' : 'user.target_cleared',
        resourceType: 'user',
        resourceId: userId,
        changes: target ?? {},
      });
    });
  }

  async warn(userId: string, reason: string, note: string): Promise<{ id: string }> {
    if (userId === getUserId()) throw invalid('You cannot warn yourself');
    await this.activePerson(userId, 'warn them');
    return this.uow.run({ name: 'staff.warn', tenantId: requireTenantId() }, async () => {
      if (await this.staff.recentSameWarning(userId, reason, note))
        throw new ConflictError('This warning was just issued');
      const id = await this.staff.addWarning(userId, reason, note);
      await this.audit.recordInTx({
        action: 'user.warned',
        resourceType: 'user',
        resourceId: userId,
        changes: { reason },
      });
      return { id };
    });
  }

  /** The warned person confirms they have read it. Doing it twice is fine. */
  async acknowledge(warningId: string): Promise<void> {
    const me = getUserId() as UserId;
    if (await this.staff.acknowledgeWarning(warningId, me)) return;
    const mine = await this.staff.warnings(me);
    if (!mine.some((w) => w.id === warningId)) throw new NotFoundError('Warning', warningId);
  }
}

/** A one-off starting password: letters, digits and symbols, shown once to the admin. */
function startingPassword(): string {
  return `Tk-${randomBytes(9).toString('base64url')}-7a`;
}
