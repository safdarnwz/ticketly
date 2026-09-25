import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';

import {
  AppError,
  ErrorCode,
  NotFoundError,
  getUserId,
  requireTenantId,
  type Json,
  type RoleId,
  type UserId,
} from '@kernel';

import { validateWindow, type LoginWindow } from '../../domain/access-policy';
import { assertGrantable } from './permission-grant';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';
import { StaffAccessRepository } from '../../infrastructure/persistence/staff-access.repository';

/**
 * Operator-side staff access controls. Every change invalidates the user's
 * cached permission row, so it applies on their NEXT request (not at token
 * expiry): force logout (208), temporary role grants (206), contractor access
 * expiry (218/219), login time window (215), reporting manager (217), and
 * duplicate / delete custom roles (202/203).
 */
@Injectable()
export class StaffAccessService {
  constructor(
    private readonly staff: StaffAccessRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly uow: UnitOfWork,
  ) {}

  private async assertStaff(userId: string): Promise<void> {
    if (!(await this.staff.exists(userId, requireTenantId())))
      throw new NotFoundError('User', userId);
  }

  async forceLogout(userId: string): Promise<{ sessionsRevoked: number }> {
    await this.assertStaff(userId);
    if (userId === getUserId())
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Use "sign out everywhere" to end your own sessions',
      });
    await this.staff.invalidateTokens(userId, requireTenantId());
    const n = await this.sessions.revokeAllForUser(userId as UserId, 'forced-by-admin');
    await this.roles.invalidateUser(userId as UserId);
    return { sessionsRevoked: n };
  }

  async setAccess(
    userId: string,
    input: {
      accessExpiresAt?: string | null;
      loginWindow?: LoginWindow | null;
      managerId?: string | null;
    },
  ): Promise<void> {
    await this.assertStaff(userId);
    if (input.loginWindow) {
      const problem = validateWindow(input.loginWindow);
      if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
    }
    if (input.managerId) {
      if (input.managerId === userId)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'A user cannot report to themselves',
        });
      await this.assertStaff(input.managerId);
      // No reporting cycles: the proposed manager must not (indirectly) report to this user.
      if (await this.staff.reportsTo(input.managerId, userId))
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'That would create a reporting loop',
        });
    }
    await this.staff.setAccess(userId, requireTenantId(), input);
    await this.roles.invalidateUser(userId as UserId);
  }

  async grantRole(userId: string, roleId: string, expiresAt: string | null): Promise<void> {
    await this.assertStaff(userId);
    if (expiresAt && Date.parse(expiresAt) <= Date.now())
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'The end date must be in the future',
      });
    const role = await this.roles.findTenantRole(roleId as RoleId);
    if (!role) throw new NotFoundError('Role', roleId);
    assertGrantable(role.permissions);
    await this.roles.grantToUser(
      userId as UserId,
      roleId as RoleId,
      getUserId() ?? null,
      expiresAt ? new Date(expiresAt) : null,
    );
  }

  /** A custom role; every permission must be one the caller may hand out. */
  createRole(input: {
    code: string;
    name: string;
    description?: string;
    permissions: string[];
    conditions?: Record<string, Json>;
  }): Promise<RoleId> {
    assertGrantable(input.permissions);
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'role.create', tenantId }, () =>
      this.roles.createRole({ tenantId, ...input, isSystem: false }),
    );
  }

  /**
   * Replace a role's permissions. Only this tenant's roles, and the caller must
   * hold both what the role has now and what it will have — so nobody edits a
   * role that is bigger than their own.
   */
  async setRolePermissions(roleId: string, permissions: string[]): Promise<void> {
    const role = await this.roles.findTenantRole(roleId as RoleId);
    if (!role) throw new NotFoundError('Role', roleId);
    assertGrantable([...role.permissions, ...permissions]);
    await this.uow.run({ name: 'role.setPermissions', tenantId: requireTenantId() }, () =>
      this.roles.setPermissions(role.id, permissions),
    );
  }

  async duplicateRole(roleId: string, code: string, name: string) {
    const source = await this.roles.findCopyableRole(roleId as RoleId);
    if (!source) throw new NotFoundError('Role', roleId);
    assertGrantable(source.permissions);
    return this.roles.duplicate(source.id, code, name);
  }
  deleteRole(roleId: string) {
    return this.roles.softDelete(roleId as RoleId);
  }
}
