import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { type TenantId } from '@kernel';

import { type LoginWindow } from '../../domain/access-policy';
import { IS_STAFF } from './staff-sql';

/** A field left `undefined` keeps its current value; `null` clears it. */
export interface StaffAccessPatch {
  accessExpiresAt?: string | null;
  loginWindow?: LoginWindow | null;
  managerId?: string | null;
}

/** The access-control columns on an operator's staff users. */
@Injectable()
export class StaffAccessRepository {
  constructor(private readonly db: DatabaseService) {}

  async exists(userId: string, tenantId: TenantId): Promise<boolean> {
    const r = await this.db.queryOne<{ id: string }>(
      `SELECT u.id FROM users u
        WHERE u.id = $1 AND u.tenant_id = $2 AND u.deleted_at IS NULL AND ${IS_STAFF('u')}`,
      [userId, tenantId],
      { name: 'staff.exists', primary: true },
    );
    return !!r;
  }

  /** Every token issued before now stops working on its next use. */
  async invalidateTokens(userId: string, tenantId: TenantId): Promise<void> {
    await this.db.execute_(
      `UPDATE users SET tokens_valid_after = now() WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId],
      { name: 'staff.forceLogout', primary: true },
    );
  }

  /** Does `managerId` report (directly or indirectly) to `userId`? */
  async reportsTo(managerId: string, userId: string): Promise<boolean> {
    const r = await this.db.queryOne<{ hit: boolean }>(
      `WITH RECURSIVE up AS (SELECT id, manager_id FROM users WHERE id = $1
         UNION SELECT u.id, u.manager_id FROM users u JOIN up ON u.id = up.manager_id)
       SELECT EXISTS (SELECT 1 FROM up WHERE id = $2) AS hit`,
      [managerId, userId],
      { name: 'staff.managerCycle', primary: true },
    );
    return !!r?.hit;
  }

  async setAccess(userId: string, tenantId: TenantId, patch: StaffAccessPatch): Promise<void> {
    await this.db.execute_(
      `UPDATE users SET
         access_expires_at = CASE WHEN $3 THEN $4::timestamptz ELSE access_expires_at END,
         login_window      = CASE WHEN $5 THEN $6::jsonb ELSE login_window END,
         manager_id        = CASE WHEN $7 THEN $8::uuid ELSE manager_id END
       WHERE id = $1 AND tenant_id = $2`,
      [
        userId,
        tenantId,
        patch.accessExpiresAt !== undefined,
        patch.accessExpiresAt ?? null,
        patch.loginWindow !== undefined,
        patch.loginWindow ? JSON.stringify(patch.loginWindow) : null,
        patch.managerId !== undefined,
        patch.managerId ?? null,
      ],
      { name: 'staff.setAccess', primary: true },
    );
  }
}
