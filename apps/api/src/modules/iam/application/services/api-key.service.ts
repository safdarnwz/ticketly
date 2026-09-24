import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { CacheService } from '@cache';
import {
  newId,
  NotFoundError,
  requireTenantId,
  type ApiKeyId,
  type TenantId,
  type UserId,
} from '@kernel';
import { randomToken } from '@security';

import { ApiKeyRepository } from '../../infrastructure/persistence/api-key.repository';

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
 * Operator API keys for server-to-server access (sent as `X-Api-Key`).
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
    private readonly keys: ApiKeyRepository,
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

    await this.keys.insert({
      id,
      tenantId,
      name: input.name,
      prefix,
      keyHash,
      scopes: input.scopes,
      ipAllowlist: input.ipAllowlist ?? [],
      expiresAt: input.expiresAt ?? null,
      createdBy: input.createdBy ?? null,
    });
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
        const row = await this.keys.findActiveByPrefix(prefix);
        if (!row) return null;
        return {
          id: row.id,
          tenantId: row.tenantId,
          name: row.name,
          prefix: row.prefix,
          keyHash: row.keyHash,
          scopes: row.scopes,
          ipAllowlist: row.ipAllowlist,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        };
      },
    );

    if (!record) return null;
    if (!timingSafeStrEqual(record.keyHash, presentedHash)) return null;
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) return null;
    if (record.ipAllowlist.length > 0 && callerIp && !ipAllowed(callerIp, record.ipAllowlist))
      return null;

    // Best-effort last-used stamp; never block the request on it.
    void this.keys.touch(record.id).catch(() => undefined);

    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      prefix: record.prefix,
      scopes: record.scopes,
      ipAllowlist: record.ipAllowlist,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : null,
      revokedAt: null,
    };
  }

  async revoke(id: ApiKeyId): Promise<void> {
    const prefix = await this.keys.revoke(id, requireTenantId());
    if (!prefix) throw new NotFoundError('API key', id);
    await this.cache.invalidate(prefix, 'apikey');
  }

  async list(): Promise<ApiKeyRecord[]> {
    const rows = await this.keys.listActive(requireTenantId());
    return rows.map(({ keyHash: _hash, ...key }) => key);
  }
}

interface CachedKey {
  id: ApiKeyId;
  tenantId: TenantId;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  ipAllowlist: string[];
  expiresAt: string | null;
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
  return cidrs.some(
    (c) => c === clean || c.startsWith(`${clean}/`) || clean.startsWith(c.split('/')[0]),
  );
}
