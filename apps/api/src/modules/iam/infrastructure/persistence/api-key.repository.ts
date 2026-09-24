import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { type ApiKeyId, type TenantId, type UserId } from '@kernel';

export interface ApiKeyRow {
  id: ApiKeyId;
  tenantId: TenantId;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: string[];
  ipAllowlist: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

interface DbRow {
  id: ApiKeyId;
  tenant_id: TenantId;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string[];
  ip_allowlist: unknown[];
  expires_at: Date | null;
  revoked_at: Date | null;
}

const COLUMNS =
  'id, tenant_id, name, prefix, key_hash, scopes, ip_allowlist, expires_at, revoked_at';

const toRow = (r: DbRow): ApiKeyRow => ({
  id: r.id,
  tenantId: r.tenant_id,
  name: r.name,
  prefix: r.prefix,
  keyHash: r.key_hash,
  scopes: r.scopes,
  ipAllowlist: (r.ip_allowlist ?? []).map(String),
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
});

/** api_keys: only the SHA-256 of a key is stored; the prefix is indexed for lookup. */
@Injectable()
export class ApiKeyRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(key: {
    id: ApiKeyId;
    tenantId: TenantId;
    name: string;
    prefix: string;
    keyHash: string;
    scopes: string[];
    ipAllowlist: string[];
    expiresAt: Date | null;
    createdBy: UserId | null;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO api_keys (id, tenant_id, name, prefix, key_hash, scopes, ip_allowlist, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        key.id,
        key.tenantId,
        key.name,
        key.prefix,
        key.keyHash,
        key.scopes,
        key.ipAllowlist,
        key.expiresAt,
        key.createdBy,
      ],
      { name: 'apikey.issue', primary: true },
    );
  }

  /** The unrevoked key with this prefix, across tenants (the key identifies its tenant). */
  async findActiveByPrefix(prefix: string): Promise<ApiKeyRow | null> {
    const row = await this.db.queryOne<DbRow>(
      `SELECT ${COLUMNS} FROM api_keys WHERE prefix = $1 AND revoked_at IS NULL`,
      [prefix],
      { name: 'apikey.load', primary: true },
    );
    return row ? toRow(row) : null;
  }

  async touch(id: ApiKeyId): Promise<void> {
    await this.db.execute_(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [id], {
      name: 'apikey.touch',
      primary: true,
    });
  }

  /** Revokes the key; returns its prefix, or null if there was no active key. */
  async revoke(id: ApiKeyId, tenantId: TenantId): Promise<string | null> {
    const row = await this.db.queryOne<{ prefix: string }>(
      `UPDATE api_keys SET revoked_at = now()
        WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL RETURNING prefix`,
      [id, tenantId],
      { name: 'apikey.revoke', primary: true },
    );
    return row?.prefix ?? null;
  }

  async listActive(tenantId: TenantId): Promise<ApiKeyRow[]> {
    const rows = await this.db.query<DbRow>(
      `SELECT ${COLUMNS} FROM api_keys
        WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [tenantId],
      { name: 'apikey.list' },
    );
    return rows.map(toRow);
  }
}
