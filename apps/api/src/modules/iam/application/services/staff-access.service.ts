import { Injectable } from '@nestjs/common';

import {
  AppError,
  ErrorCode,
  NotFoundError,
  getUserId,
  requireTenantId,
  type RoleId,
  type UserId,
} from '@kernel';

import { validateWindow, type LoginWindow } from '../../domain/access-policy';
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
    await this.roles.grantToUser(
      userId as UserId,
      roleId as RoleId,
      getUserId() ?? null,
      expiresAt ? new Date(expiresAt) : null,
    );
  }

  duplicateRole(roleId: string, code: string, name: string) {
    return this.roles.duplicate(roleId as RoleId, code, name);
  }
  deleteRole(roleId: string) {
    return this.roles.softDelete(roleId as RoleId);
  }
}
