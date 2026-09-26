import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';

import {
  AppError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  getContext,
  getUserId,
  requireTenantId,
  type Json,
  type RoleId,
  type UserId,
} from '@kernel';

import { PERMISSION_CATALOGUE } from '../../domain/permission-catalogue';
import { permissionGrantProblems } from '../../domain/permission-grant';
import { validateWindow, type LoginWindow } from '../../domain/access-policy';
import { assertGrantable } from './permission-grant';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';
import { StaffAccessRepository } from '../../infrastructure/persistence/staff-access.repository';
import { StaffDirectoryRepository } from '../../infrastructure/persistence/staff-directory.repository';

const MANAGES_STAFF = ['user:manage', '*'];
const lastManager = () =>
  new AppError(ErrorCode.COMMON_VALIDATION, 422, {
    message: 'Nobody else could manage staff then — give someone else that role first',
  });
const invalid = (message: string) => new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });

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
    private readonly directory: StaffDirectoryRepository,
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
    if (userId === getUserId() && (input.accessExpiresAt || input.loginWindow))
      throw invalid('You cannot limit your own access — ask another admin');
    if (input.accessExpiresAt && Date.parse(input.accessExpiresAt) <= Date.now())
      throw invalid('Access must end in the future — disable the account to stop it now');
    if (
      (input.accessExpiresAt || input.loginWindow) &&
      (await this.directory.canManageUsers(userId)) &&
      (await this.directory.activeUserManagers(userId)) === 0
    )
      throw invalid(
        'This is the last person who can manage staff — their access cannot be limited',
      );
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
    // Making the last staff manager's managing role temporary would lock everyone out later.
    if (
      expiresAt &&
      role.permissions.some((p) => MANAGES_STAFF.includes(p)) &&
      !(await this.directory.canManageUsers(userId, roleId)) &&
      (await this.directory.canManageUsers(userId)) &&
      (await this.directory.activeUserManagers(userId)) === 0
    )
      throw lastManager();
    await this.roles.grantToUser(
      userId as UserId,
      roleId as RoleId,
      getUserId() ?? null,
      expiresAt ? new Date(expiresAt) : null,
    );
  }

  /** A custom role; every permission must be one the caller may hand out. */
  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    if (await this.roles.nameTaken(name, exceptId))
      throw new ConflictError('A role with this name already exists');
  }

  async createRole(input: {
    code: string;
    name: string;
    description?: string;
    permissions: string[];
    conditions?: Record<string, Json>;
  }): Promise<RoleId> {
    assertGrantable(input.permissions);
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'role.create', tenantId }, async () => {
      await this.assertNameFree(input.name);
      return this.roles.createRole({ tenantId, ...input, isSystem: false });
    });
  }

  /**
   * Replace a role's permissions. Only this tenant's roles, and the caller must
   * hold both what the role has now and what it will have — so nobody edits a
   * role that is bigger than their own.
   */
  async setRolePermissions(roleId: string, permissions: string[]): Promise<void> {
    const role = await this.roles.findTenantRole(roleId as RoleId);
    if (!role) throw new NotFoundError('Role', roleId);
    if (role.isSystem)
      throw invalid("Built-in roles can't be changed — duplicate it and change the copy");
    assertGrantable([...role.permissions, ...permissions]);
    if (
      role.permissions.some((p) => MANAGES_STAFF.includes(p)) &&
      !permissions.some((p) => MANAGES_STAFF.includes(p)) &&
      (await this.directory.activeUserManagers(undefined, roleId)) === 0
    )
      throw lastManager();
    await this.uow.run({ name: 'role.setPermissions', tenantId: requireTenantId() }, () =>
      this.roles.setPermissions(role.id, permissions),
    );
  }

  async duplicateRole(roleId: string, code: string, name: string) {
    const source = await this.roles.findCopyableRole(roleId as RoleId);
    if (!source) throw new NotFoundError('Role', roleId);
    assertGrantable(source.permissions);
    return this.uow.run({ name: 'role.duplicate', tenantId: requireTenantId() }, async () => {
      await this.assertNameFree(name);
      return this.roles.duplicate(source.id, code, name);
    });
  }
  /** The role editor's list: every operator permission, and whether the caller may hand it out. */
  permissionCatalogue() {
    const held = getContext()?.permissions ?? new Set<string>();
    return PERMISSION_CATALOGUE.map((g) => ({
      group: g.group,
      items: g.items.map((i) => ({
        ...i,
        grantable: permissionGrantProblems([i.code], held).length === 0,
      })),
    }));
  }

  deleteRole(roleId: string) {
    return this.roles.softDelete(roleId as RoleId);
  }
}
