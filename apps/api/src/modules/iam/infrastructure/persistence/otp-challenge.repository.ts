import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { type TenantId } from '@kernel';

export interface OtpChallenge {
  id: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
}

/** otp_challenges: one row per code sent; only the code's hash is stored. */
@Injectable()
export class OtpChallengeRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(c: {
    id: string;
    tenantId: TenantId | null;
    identity: string;
    purpose: string;
    codeHash: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO otp_challenges (id, tenant_id, identity, purpose, code_hash, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))`,
      [c.id, c.tenantId, c.identity, c.purpose, c.codeHash, c.ttlSeconds],
      { name: 'otp.insert', primary: true, tenantId: c.tenantId },
    );
  }

  /** Codes sent to this identity in the last `seconds` (resend cooldown). */
  async countSentSince(
    identity: string,
    seconds: number,
    tenantId: TenantId | null,
  ): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM otp_challenges
        WHERE identity = $1 AND created_at > now() - make_interval(secs => $2)`,
      [identity, seconds],
      { name: 'otp.countRecent', primary: true, tenantId },
    );
    return Number(row?.n ?? 0);
  }

  /**
   * The newest unexpired, unconsumed code for identity + purpose, row-locked.
   * Must run inside a unit of work.
   */
  async lockLatestActive(
    tenantId: TenantId | null,
    identity: string,
    purpose: string,
  ): Promise<OtpChallenge | null> {
    const row = await this.db.queryOne<{
      id: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
    }>(
      `SELECT id, code_hash, attempts, max_attempts FROM otp_challenges
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND identity = $2 AND purpose = $3
          AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [tenantId, identity, purpose],
      { name: 'otp.lockLatest', primary: true },
    );
    return row
      ? {
          id: row.id,
          codeHash: row.code_hash,
          attempts: row.attempts,
          maxAttempts: row.max_attempts,
        }
      : null;
  }

  async recordFailedAttempt(id: string): Promise<void> {
    await this.db.execute_(
      `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`,
      [id],
      {
        name: 'otp.failedAttempt',
        primary: true,
      },
    );
  }

  async consume(id: string): Promise<void> {
    await this.db.execute_(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [id], {
      name: 'otp.consume',
      primary: true,
    });
  }
}
