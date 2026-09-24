import { DatabaseService } from '@database';
import { getTenantId } from '@kernel';

const scope = (): string | null => (getTenantId() as string | undefined) ?? null;

import type { ObjectStorage, PutOptions } from './object-storage';

/**
 * Local-dev / test provider: bytes in Postgres (stored_file_blobs), RLS
 * scoped. Never used when STORAGE_PROVIDER points at a real cloud. Signed
 * URLs are not possible, so the API streams these files itself.
 */
export class DatabaseStorage implements ObjectStorage {
  readonly provider = 'database' as const;
  readonly bucket = '';

  constructor(private readonly db: DatabaseService) {}

  async put(key: string, body: Buffer, opts: PutOptions): Promise<void> {
    await this.db.execute_(
      `INSERT INTO stored_file_blobs (object_key, tenant_id, content, content_type) VALUES ($1,$2,$3,$4)
       ON CONFLICT (object_key) DO UPDATE SET content = EXCLUDED.content, content_type = EXCLUDED.content_type`,
      [key, scope(), body, opts.contentType],
      { name: 'storage.db.put', primary: true },
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const row = await this.db.queryOne<{ content: Buffer }>(
      `SELECT content FROM stored_file_blobs WHERE object_key = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [key, scope()],
      { name: 'storage.db.get', primary: true },
    );
    return row?.content ?? null;
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT octet_length(content) AS n FROM stored_file_blobs WHERE object_key = $1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [key, scope()],
      { name: 'storage.db.head', primary: true },
    );
    return row ? { sizeBytes: Number(row.n) } : null;
  }

  async delete(key: string): Promise<void> {
    await this.db.execute_(`DELETE FROM stored_file_blobs WHERE object_key = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [key, scope()], { name: 'storage.db.delete', primary: true });
  }

  async signedGetUrl(): Promise<null> {
    return null;
  }
}
