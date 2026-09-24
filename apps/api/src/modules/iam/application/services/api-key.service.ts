import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { CacheService} from '@cache';
import { DatabaseService } from '@database';
import { newId, NotFoundError, requireTenantId, type ApiKeyId, type TenantId, type UserId } from '@kernel';
import { randomToken } from '@security';

export interface ApiKeyRecord {
  id: ApiKeyId;
  tenantId: TenantId;
  name: string;
  prefix: string;
  scopes: string[];
  ipAllowlist: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * API keys for OTA / channel-partner server-to-server access.
 *
 * SHAPE: `gds_<prefix8>_<secret>`. Only a SHA-256 of the whole key is stored;
 * the plaintext is returned exactly once at creation. The 8-char prefix is
 * stored in clear and indexed so verification is a single indexed lookup, not a
 * scan-and-compare over every key.
 *
 * Verification is cache-backed (short TTL) because a busy OTA integration
 * presents the same key on every one of thousands of requests per minute — we
 * must not hit Postgres for each. Revocation invalidates the cache entry.
 */
@Injectable()
export class ApiKeyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  /** Issue a new key. The plaintext is only ever seen here. */
  async issue(input: {
    name: string;
    scopes: string[];
    ipAllowlist?: string[];
    expiresAt?: Date | null;
    createdBy?: UserId | null;
  }): Promise<{ id: ApiKeyId; plaintext: string; prefix: string }> {
    const tenantId = requireTenantId();
    const id = newId() as ApiKeyId;
    const secret = randomToken(24);
    const prefix = randomToken(6).slice(0, 8);
    const plaintext = `gds_${prefix}_${secret}`;
    const keyHash = hashKey(plaintext);

    await this.db.execute_(
      `INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, ip_allowlist, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, tenantId, input.name, prefix, keyHash, input.scopes, input.ipAllowlist ?? [], input.expiresAt ?? null, input.createdBy ?? null],
      { name: 'apikey.issue', primary: true },
    );
    return { id, plaintext, prefix };
  }

  /**
   * Verify a presented key. Returns the record (with tenant + scopes) or null.
   * Cached by prefix; the cached entry stores the hash so a wrong secret with a
   * valid prefix still fails.
   */
  async verify(plaintext: string, callerIp?: string): Promise<ApiKeyRecord | null> {
    const match = /^gds_([a-zA-Z0-9_-]{8})_/.exec(plaintext);
    if (!match) return null;
    const prefix = match[1];
    const presentedHash = hashKey(plaintext);

    const record = await this.cache.getOrLoad<CachedKey | null>(
      prefix,
      { namespace: 'apikey', ttlSeconds: 60 },
      async () => {
        const row = await this.db.queryOne<KeyRow>(
          `SELECT id, tenant_id, name, prefix, key_hash, scopes, ip_allowlist, expires_at, revoked_at
             FROM api_keys WHERE prefix = $1 AND revoked_at IS NULL`,
          [prefix],
          { name: 'apikey.load', primary: true },
        );
        if (!row) return null;
        return {
          id: row.id, tenantId: row.tenant_id, name: row.name, prefix: row.prefix,
          keyHash: row.key_hash, scopes: row.scopes,
          ipAllowlist: (row.ip_allowlist ?? []).map(String),
          expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
        };
      },
    );

    if (!record) return null;
    if (!timingSafeStrEqual(record.keyHash, presentedHash)) return null;
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;
    if (record.ipAllowlist.length > 0 && callerIp && !ipAllowed(callerIp, record.ipAllowlist)) return null;

    // Best-effort last-used stamp; never block the request on it.
    void this.db.execute_(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [record.id], { name: 'apikey.touch', primary: true }).catch(() => undefined);

    return {
      id: record.id, tenantId: record.tenantId, name: record.name, prefix: record.prefix,
      scopes: record.scopes, ipAllowlist: record.ipAllowlist,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : null, revokedAt: null,
    };
  }

  async revoke(id: ApiKeyId): Promise<void> {
    const tenantId = requireTenantId();
    const row = await this.db.queryOne<{ prefix: string }>(
      `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING prefix`,
      [id, tenantId],
      { name: 'apikey.revoke', primary: true },
    );
    if (!row) throw new NotFoundError('API key', id);
    await this.cache.invalidate(row.prefix, 'apikey');
  }

  async list(): Promise<ApiKeyRecord[]> {
    const tenantId = requireTenantId();
    const rows = await this.db.query<KeyRow>(
      `SELECT id, tenant_id, name, prefix, key_hash, scopes, ip_allowlist, expires_at, revoked_at
         FROM api_keys WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [tenantId],
      { name: 'apikey.list' },
    );
    return rows.map((row) => ({
      id: row.id, tenantId: row.tenant_id, name: row.name, prefix: row.prefix,
      scopes: row.scopes, ipAllowlist: (row.ip_allowlist ?? []).map(String),
      expiresAt: row.expires_at, revokedAt: row.revoked_at,
    }));
  }
}

interface KeyRow {
  id: ApiKeyId; tenant_id: TenantId; name: string; prefix: string; key_hash: string;
  scopes: string[]; ip_allowlist: unknown[]; expires_at: Date | null; revoked_at: Date | null;
}
interface CachedKey {
  id: ApiKeyId; tenantId: TenantId; name: string; prefix: string; keyHash: string;
  scopes: string[]; ipAllowlist: string[]; expiresAt: string | null;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
function timingSafeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function ipAllowed(ip: string, cidrs: string[]): boolean {
  // Simple exact / prefix match; a full CIDR match lib is added in Part 10 if
  // partners need ranges. Exact IP allow-listing covers the common case.
  const clean = ip.replace(/^::ffff:/, '');
  return cidrs.some((c) => c === clean || c.startsWith(`${clean}/`) || clean.startsWith(c.split('/')[0]));
}
