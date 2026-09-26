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

  async assignRoles(userId: UserId, roleCodes: string[]): Promise<void> {
    await this.uow.run({ name: 'user.assignRoles', tenantId: requireTenantId() }, async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('User', userId);
      // Resolve every code first so a bad one fails before we change anything.
      const roleIds = [];
      for (const code of roleCodes) {
        const role = await this.roles.findByCode(code);
        if (!role) throw new NotFoundError('Role', code);
        assertGrantable(role.permissions);
        roleIds.push(role.id);
      }
      for (const roleId of roleIds)
        await this.roles.grantToUser(userId, roleId, getUserId() ?? null);
      // Role change → existing access tokens carry stale permissions. Force a
      // re-login by revoking sessions (the customer app refreshes silently).
      await this.sessions.revokeAllForUser(userId, 'roles-changed');
      await this.audit.recordInTx({
        action: 'user.roles_assigned',
        resourceType: 'user',
        resourceId: userId,
        changes: { roles: roleCodes },
      });
    });
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
