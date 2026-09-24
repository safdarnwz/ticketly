import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { AppError, ErrorCode, NotFoundError, getUserId, requireTenantId, type RoleId, type UserId } from '@kernel';

import { validateWindow, type LoginWindow } from '../../domain/access-policy';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';

/**
 * Operator-side staff access controls. Every change invalidates the user's
 * cached permission row, so it applies on their NEXT request (not at token
 * expiry): force logout (208), temporary role grants (206), contractor access
 * expiry (218/219), login time window (215), reporting manager (217), and
 * duplicate / delete custom roles (202/203).
 */
@Injectable()
export class StaffAccessService {
  constructor(private readonly db: DatabaseService, private readonly roles: RoleRepository, private readonly sessions: SessionRepository) {}

  private async assertStaff(userId: string): Promise<void> {
    const r = await this.db.queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [userId, requireTenantId()], { name: 'staff.exists', primary: true });
    if (!r) throw new NotFoundError('User', userId);
  }

  async forceLogout(userId: string): Promise<{ sessionsRevoked: number }> {
    await this.assertStaff(userId);
    if (userId === getUserId()) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Use "sign out everywhere" to end your own sessions' });
    await this.db.execute_(`UPDATE users SET tokens_valid_after = now() WHERE id = $1 AND tenant_id = $2`, [userId, requireTenantId()], { name: 'staff.forceLogout', primary: true });
    const n = await this.sessions.revokeAllForUser(userId as UserId, 'forced-by-admin');
    await this.roles.invalidateUser(userId as UserId);
    return { sessionsRevoked: n };
  }

  async setAccess(userId: string, input: { accessExpiresAt?: string | null; loginWindow?: LoginWindow | null; managerId?: string | null }): Promise<void> {
    await this.assertStaff(userId);
    if (input.loginWindow) {
      const problem = validateWindow(input.loginWindow);
      if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
    }
    if (input.managerId) {
      if (input.managerId === userId) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'A user cannot report to themselves' });
      await this.assertStaff(input.managerId);
      // No reporting cycles: the proposed manager must not (indirectly) report to this user.
      const cycle = await this.db.queryOne<{ hit: boolean }>(
        `WITH RECURSIVE up AS (SELECT id, manager_id FROM users WHERE id = $1
           UNION SELECT u.id, u.manager_id FROM users u JOIN up ON u.id = up.manager_id)
         SELECT EXISTS (SELECT 1 FROM up WHERE id = $2) AS hit`, [input.managerId, userId], { name: 'staff.managerCycle', primary: true });
      if (cycle?.hit) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'That would create a reporting loop' });
    }
    await this.db.execute_(
      `UPDATE users SET
         access_expires_at = CASE WHEN $3 THEN $4::timestamptz ELSE access_expires_at END,
         login_window      = CASE WHEN $5 THEN $6::jsonb ELSE login_window END,
         manager_id        = CASE WHEN $7 THEN $8::uuid ELSE manager_id END
       WHERE id = $1 AND tenant_id = $2`,
      [userId, requireTenantId(), input.accessExpiresAt !== undefined, input.accessExpiresAt ?? null,
        input.loginWindow !== undefined, input.loginWindow ? JSON.stringify(input.loginWindow) : null,
        input.managerId !== undefined, input.managerId ?? null],
      { name: 'staff.setAccess', primary: true });
    await this.roles.invalidateUser(userId as UserId);
  }

  async grantRole(userId: string, roleId: string, expiresAt: string | null): Promise<void> {
    await this.assertStaff(userId);
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'The end date must be in the future' });
    await this.roles.grantToUser(userId as UserId, roleId as RoleId, (getUserId() ?? null) as UserId | null, expiresAt ? new Date(expiresAt) : null);
  }

  duplicateRole(roleId: string, code: string, name: string) { return this.roles.duplicate(roleId as RoleId, code, name); }
  deleteRole(roleId: string) { return this.roles.softDelete(roleId as RoleId); }
}
