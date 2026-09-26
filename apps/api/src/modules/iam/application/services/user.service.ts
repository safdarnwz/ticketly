import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  getUserId,
  newId,
  requireTenantId,
  type UserId,
} from '@kernel';
import { PasswordHasher } from '@security';

import { AuditService } from './audit.service';
import { assertGrantable } from './permission-grant';
import { User } from '../../domain/user.entity';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';
import { UserRepository } from '../../infrastructure/persistence/user.repository';
import { StaffAccessRepository } from '../../infrastructure/persistence/staff-access.repository';
import { StaffDirectoryRepository } from '../../infrastructure/persistence/staff-directory.repository';
import { PlanQuotaService, QUOTA_KEYS } from '../../../entitlements';
import { PlatformPoliciesService } from '../../../platform-settings';

/**
 * Operator user management (invite / update / role assignment).
 *
 * Every mutation is a unit of work that also writes an audit entry in the same
 * transaction — so "who was invited / disabled / re-roled, and by whom" can
 * never diverge from what actually happened.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly policies: PlatformPoliciesService,
    private readonly planQuotas: PlanQuotaService,
    private readonly staff: StaffDirectoryRepository,
    private readonly access: StaffAccessRepository,
  ) {}

  /** Nobody may take away the operator's last way to manage its staff. */
  private async assertNotLastManager(userId: string, withoutRoleId?: string): Promise<void> {
    const managesNow = await this.staff.canManageUsers(userId);
    const managesAfter = withoutRoleId
      ? await this.staff.canManageUsers(userId, withoutRoleId)
      : false;
    if (managesNow && !managesAfter && (await this.staff.activeUserManagers(userId)) === 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'This is the last person who can manage staff — give someone else that role first',
      });
  }

  async invite(input: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    roles: string[];
  }): Promise<UserId> {
    const tenantId = requireTenantId();
    await this.planQuotas.assertCanAdd(
      QUOTA_KEYS.users,
      await this.users.countActiveStaff(),
      'staff users',
    );
    const existing = await this.users.findByEmail(input.email);
    if (existing) throw new ConflictError('A user with this email already exists');

    await this.policies.assertPasswordAcceptable(input.password);
    const passwordHash = await this.hasher.hash(input.password);
    const user = User.create(
      newId() as UserId,
      {
        tenantId,
        kind: 'staff',
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        status: 'active',
      } as never,
    );

    await this.uow.run({ name: 'user.invite', tenantId }, async () => {
      await this.users.insert(user);
      for (const code of input.roles) {
        const role = await this.roles.findByCode(code);
        if (!role) throw new NotFoundError('Role', code);
        assertGrantable(role.permissions);
        await this.roles.grantToUser(user.id, role.id, getUserId() ?? null);
      }
      await this.audit.recordInTx({
        action: 'user.invited',
        resourceType: 'user',
        resourceId: user.id,
        changes: { roles: input.roles },
      });
    });
    return user.id;
  }

  async update(
    userId: UserId,
    patch: { fullName?: string; phone?: string; status?: 'active' | 'disabled' },
  ): Promise<void> {
    await this.uow.run({ name: 'user.update', tenantId: requireTenantId() }, async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('User', userId);
      if (patch.fullName || patch.phone)
        user.updateProfile({
          fullName: patch.fullName ?? user.snapshot().fullName,
          phone: patch.phone ?? user.snapshot().phone,
        });
      if (patch.status === 'disabled') {
        if (userId === getUserId())
          throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
            message: 'You cannot disable your own account',
          });
        await this.assertNotLastManager(userId);
        user.disable();
        await this.sessions.revokeAllForUser(userId, 'user-disabled');
      }
      if (patch.status === 'active') user.enable();
      await this.users.update(user, user.version);
      await this.audit.recordInTx({
        action: 'user.updated',
        resourceType: 'user',
        resourceId: userId,
        changes: patch,
      });
    });
  }

  /**
   * An admin sets a new password for a staff member who is locked out (209).
   * Their sessions end at once; your own password is changed from your profile.
   */
  async resetPassword(userId: UserId, password: string): Promise<void> {
    if (userId === getUserId())
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Change your own password from your profile',
      });
    await this.policies.assertPasswordAcceptable(password);
    const hash = await this.hasher.hash(password);
    await this.uow.run({ name: 'user.resetPassword', tenantId: requireTenantId() }, async () => {
      const user = await this.users.findById(userId);
      if (!user || !(await this.staff.find(userId))) throw new NotFoundError('User', userId);
      user.setPassword(hash);
      user.unlock();
      await this.users.update(user, user.version);
      await this.access.invalidateTokens(userId, requireTenantId());
      await this.sessions.revokeAllForUser(userId, 'password-reset-by-admin');
      await this.audit.recordInTx({
        action: 'user.password_reset',
        resourceType: 'user',
        resourceId: userId,
        changes: {},
      });
    });
    // After commit, so no request re-caches the old sign-in cut-off.
    await this.roles.invalidateUser(userId);
  }

  /** Take one role away; a staff member keeps at least one, and the last user manager keeps theirs. */
  async revokeRole(userId: UserId, roleId: string): Promise<void> {
    await this.uow.run({ name: 'user.revokeRole', tenantId: requireTenantId() }, async () => {
      const person = await this.staff.find(userId);
      if (!person) throw new NotFoundError('User', userId);
      if (!person.roles.some((r) => r.id === roleId)) throw new NotFoundError('Role', roleId);
      if (person.roles.length === 1)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'A staff member needs at least one role — give another first, or disable them',
        });
      await this.assertNotLastManager(userId, roleId);
      await this.roles.revokeFromUser(userId, roleId as never);
      await this.sessions.revokeAllForUser(userId, 'roles-changed');
      await this.audit.recordInTx({
        action: 'user.role_revoked',
        resourceType: 'user',
        resourceId: userId,
        changes: { roleId },
      });
    });
  }

  /** Move a staff member to a branch (an active one of this operator), or off every branch. */
  async setBranch(userId: UserId, branchId: string | null): Promise<void> {
    await this.uow.run({ name: 'user.setBranch', tenantId: requireTenantId() }, async () => {
      const person = await this.staff.find(userId);
      if (!person) throw new NotFoundError('User', userId);
      if (branchId && !(await this.staff.activeBranch(branchId)))
        throw new NotFoundError('Branch', branchId);
      if (person.branchId === branchId) return;
      await this.staff.setBranch(userId, branchId);
      await this.audit.recordInTx({
        action: 'user.branch_changed',
        resourceType: 'user',
        resourceId: userId,
        changes: { from: person.branchId, to: branchId },
      });
    });
  }
}
