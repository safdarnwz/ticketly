import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type SessionId, type TenantId, type UserId } from '@kernel';

export interface SessionRecord {
  id: SessionId;
  userId: UserId;
  tenantId: TenantId | null;
  revokedAt: Date | null;
  expiresAt: Date;
  parentId: SessionId | null;
}

/**
 * Session (refresh-token) store.
 *
 * The refresh token is never stored — only its SHA-256. Rotation forms a chain
 * (`parent_id`): each refresh revokes the used token and issues a new one. If a
 * revoked token is ever replayed (a sign of theft), the whole chain for that
 * user can be killed. This is the standard defence against refresh-token replay.
 */
@Injectable()
export class SessionRepository {
  constructor(private readonly db: DatabaseService) {}

  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(input: {
    userId: UserId;
    tenantId: TenantId | null;
    refreshToken: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
    parentId?: SessionId | null;
  }): Promise<SessionId> {
    const id = newId() as SessionId;
    await this.db.execute_(
      `INSERT INTO sessions (id, tenant_id, user_id, refresh_hash, user_agent, ip, parent_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, input.tenantId, input.userId, SessionRepository.hashToken(input.refreshToken),
       input.userAgent ?? null, input.ip ?? null, input.parentId ?? null, input.expiresAt],
      { name: 'session.create', primary: true },
    );
    return id;
  }

  async findActiveByToken(refreshToken: string): Promise<SessionRecord | null> {
    return this.db.queryOne<SessionRecord>(
      `SELECT id, user_id AS "userId", tenant_id AS "tenantId",
              revoked_at AS "revokedAt", expires_at AS "expiresAt", parent_id AS "parentId"
         FROM sessions
        WHERE refresh_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [SessionRepository.hashToken(refreshToken)],
      { name: 'session.findActiveByToken', primary: true },
    );
  }

  async findById(id: SessionId): Promise<SessionRecord | null> {
    return this.db.queryOne<SessionRecord>(
      `SELECT id, user_id AS "userId", tenant_id AS "tenantId",
              revoked_at AS "revokedAt", expires_at AS "expiresAt", parent_id AS "parentId"
         FROM sessions WHERE id = $1`,
      [id],
      { name: 'session.findById', primary: true },
    );
  }

  async revoke(id: SessionId, reason: string): Promise<void> {
    await this.db.execute_(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [id, reason],
      { name: 'session.revoke', primary: true },
    );
  }

  /** Kill every active session for a user (logout-all, password change, admin). */
  async revokeAllForUser(userId: UserId, reason: string): Promise<number> {
    return this.db.execute_(
      `UPDATE sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason],
      { name: 'session.revokeAll', primary: true },
    );
  }

  async touch(id: SessionId): Promise<void> {
    await this.db.execute_(
      `UPDATE sessions SET last_used_at = now() WHERE id = $1`,
      [id],
      { name: 'session.touch', primary: true },
    );
  }
}
