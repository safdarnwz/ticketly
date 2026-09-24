import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import type { TenantId, Uuid } from '@kernel';

export type IdempotencyStatus = 'in_progress' | 'completed';

export interface IdempotencyRecord {
  key: string;
  fingerprint: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
}

/**
 * Persistence for idempotent request replay.
 *
 * WHY POSTGRES AND NOT REDIS: the record must be as durable as the booking it
 * guards. If Redis is flushed, a retried "confirm booking" would execute twice
 * and charge the passenger twice. Postgres also gives us the atomic
 * `INSERT ... ON CONFLICT DO NOTHING` claim in a single round trip.
 */
@Injectable()
export class IdempotencyStore {
  constructor(private readonly db: DatabaseService) {}

  /** Fingerprint pins the key to one specific request shape. */
  static fingerprint(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(method)
      .update('\n')
      .update(path)
      .update('\n')
      .update(body === undefined ? '' : JSON.stringify(body))
      .digest('hex');
  }

  /**
   * Atomically claim the key. Returns `null` when we won the race (the caller
   * proceeds to execute), or the existing record when someone else owns it.
   */
  async claim(input: {
    key: string;
    tenantId: TenantId | null;
    userId: Uuid | null;
    fingerprint: string;
    method: string;
    path: string;
    ttlSeconds: number;
  }): Promise<IdempotencyRecord | null> {
    const inserted = await this.db.queryOne<{ key: string }>(
      `INSERT INTO idempotency_keys
         (key, tenant_id, user_id, fingerprint, method, path, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'in_progress', now() + make_interval(secs => $7))
       ON CONFLICT (key, tenant_id) DO NOTHING
       RETURNING key`,
      [input.key, input.tenantId, input.userId, input.fingerprint, input.method, input.path, input.ttlSeconds],
      { name: 'idempotency.claim', primary: true },
    );

    if (inserted) return null;

    return this.db.queryOne<IdempotencyRecord>(
      `SELECT key,
              fingerprint,
              status,
              response_status AS "responseStatus",
              response_body   AS "responseBody",
              created_at      AS "createdAt"
         FROM idempotency_keys
        WHERE key = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [input.key, input.tenantId],
      { name: 'idempotency.read', primary: true },
    );
  }

  /** Store the completed response so retries replay it verbatim. */
  async complete(
    key: string,
    tenantId: TenantId | null,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE idempotency_keys
          SET status = 'completed',
              response_status = $3,
              response_body = $4::jsonb,
              completed_at = now()
        WHERE key = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [key, tenantId, responseStatus, JSON.stringify(responseBody ?? null)],
      { name: 'idempotency.complete' },
    );
  }

  /**
   * Release a failed attempt so the client can retry with the same key.
   * Only for 5xx / infrastructure failures: a 4xx is a deterministic outcome
   * and replaying it is the correct behaviour.
   */
  async release(key: string, tenantId: TenantId | null): Promise<void> {
    await this.db.execute_(
      `DELETE FROM idempotency_keys
        WHERE key = $1 AND tenant_id IS NOT DISTINCT FROM $2 AND status = 'in_progress'`,
      [key, tenantId],
      { name: 'idempotency.release' },
    );
  }

  /** Housekeeping — called by the worker (Part 9). */
  async purgeExpired(limit = 5_000): Promise<number> {
    return this.db.execute_(
      `DELETE FROM idempotency_keys
        WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE expires_at < now() LIMIT $1)`,
      [limit],
      { name: 'idempotency.purge' },
    );
  }
}
