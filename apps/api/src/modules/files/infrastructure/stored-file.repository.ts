import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { getTenantId, type UserId } from '@kernel';

import type { AllowedMime } from '../domain/file-validation';
import type { StorageProviderName } from './storage/object-storage';

export interface StoredFileMeta {
  id: string;
  tenantId: string | null;
  purpose: string;
  provider: StorageProviderName;
  bucket: string;
  objectKey: string;
  visibility: 'public' | 'private';
  fileName: string;
  mimeType: AllowedMime;
  sizeBytes: number;
  sha256: string;
  createdAt: Date;
}

@Injectable()
export class StoredFileRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(
    input: Omit<StoredFileMeta, 'tenantId' | 'createdAt'> & { uploadedBy: UserId | null },
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO stored_files (id, tenant_id, purpose, provider, bucket, object_key, visibility, file_name, mime_type, size_bytes, sha256, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (provider, bucket, object_key) DO UPDATE SET
         file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
         sha256 = EXCLUDED.sha256, uploaded_by = EXCLUDED.uploaded_by, deleted_at = NULL`,
      [
        input.id,
        scopeTenant(),
        input.purpose,
        input.provider,
        input.bucket,
        input.objectKey,
        input.visibility,
        input.fileName,
        input.mimeType,
        input.sizeBytes,
        input.sha256,
        input.uploadedBy,
      ],
      { name: 'file.insert', primary: true },
    );
  }

  /** Tenant-scoped (RLS + explicit filter): another operator's file id simply does not exist. */
  async get(id: string): Promise<StoredFileMeta | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await this.db.queryOne<Row>(
      `SELECT ${COLS} FROM stored_files WHERE tenant_id IS NOT DISTINCT FROM $1 AND id = $2 AND deleted_at IS NULL`,
      [scopeTenant(), id],
      { name: 'file.get', primary: true },
    );
    return row ? map(row) : null;
  }

  async findByKey(provider: string, bucket: string, key: string): Promise<StoredFileMeta | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT ${COLS} FROM stored_files WHERE tenant_id IS NOT DISTINCT FROM $1 AND provider = $2 AND bucket = $3 AND object_key = $4`,
      [scopeTenant(), provider, bucket, key],
      { name: 'file.findByKey', primary: true },
    );
    return row ? map(row) : null;
  }

  /** Operator folder name; '_platform' for platform-scope files (can never collide: slugs are [a-z0-9-] only). */
  async tenantSlug(): Promise<string> {
    const tenantId = scopeTenant();
    if (!tenantId) return '_platform';
    const row = await this.db.queryOne<{ slug: string }>(
      `SELECT slug FROM tenants WHERE id = $1`,
      [tenantId],
      { name: 'file.tenantSlug' },
    );
    if (!row) throw new Error('Tenant not found for storage key');
    return row.slug;
  }

  async softDelete(id: string): Promise<void> {
    await this.db.execute_(
      `UPDATE stored_files SET deleted_at = now() WHERE tenant_id IS NOT DISTINCT FROM $1 AND id = $2`,
      [scopeTenant(), id],
      { name: 'file.softDelete', primary: true },
    );
  }
}

function scopeTenant(): string | null {
  return (getTenantId() as string | undefined) ?? null;
}

/** Platform-level lookup (RLS bypassed by the caller) — used only for PUBLIC files. */
export const PUBLIC_FILE_SQL = `SELECT id, tenant_id, purpose, provider, bucket, object_key, visibility, file_name, mime_type, size_bytes, sha256, created_at
  FROM stored_files WHERE id = $1 AND visibility = 'public' AND deleted_at IS NULL`;

const COLS = `id, tenant_id, purpose, provider, bucket, object_key, visibility, file_name, mime_type, size_bytes, sha256, created_at`;
export interface Row {
  id: string;
  tenant_id: string | null;
  purpose: string;
  provider: StorageProviderName;
  bucket: string;
  object_key: string;
  visibility: 'public' | 'private';
  file_name: string;
  mime_type: AllowedMime;
  size_bytes: number;
  sha256: string;
  created_at: Date;
}
export function map(r: Row): StoredFileMeta {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    purpose: r.purpose,
    provider: r.provider,
    bucket: r.bucket,
    objectKey: r.object_key,
    visibility: r.visibility,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    createdAt: r.created_at,
  };
}
