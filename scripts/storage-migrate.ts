/**
 * ============================================================================
 *  Move every stored file from one object-storage provider to another
 * ============================================================================
 *
 *   e.g. Cloudflare R2 → AWS S3, or R2 → Azure Blob.
 *
 * SOURCE = the current STORAGE_* env. TARGET = the same variables prefixed
 * with TARGET_ (TARGET_STORAGE_PROVIDER, TARGET_STORAGE_BUCKET, ...).
 *
 * For each registered file still on the source: read bytes → verify the
 * sha256 recorded at upload → write to the target under the SAME key →
 * read back and verify again → flip that one row to the target. Resumable
 * (already-moved rows are skipped), per-file failures are reported and never
 * abort the run, and nothing is deleted from the source (clean it up after
 * you've switched STORAGE_PROVIDER and are happy).
 *
 *   npm run storage:migrate -- --dry-run
 *   npm run storage:migrate -- --limit 500
 *
 * Cut-over: run once (bulk), set the app to the target provider, run again
 * (catches files uploaded during the first pass). Public CDN URLs keep their
 * paths because keys never change — only STORAGE_PUBLIC_BASE_URL's host does.
 */
import { createHash } from 'node:crypto';

import { Pool } from 'pg';

import { buildAppConfig, loadEnv, type AppConfig } from '@config';
import type { DatabaseService } from '@database';
import { createContext, runWithContext, type TenantId } from '@kernel';

import { createStorage } from '../apps/api/src/modules/files/infrastructure/storage/storage.factory';

function targetSettings(base: AppConfig['storage']): AppConfig['storage'] {
   
  const e = process.env;
  const provider = e.TARGET_STORAGE_PROVIDER as AppConfig['storage']['provider'] | undefined;
  if (!provider || !['r2', 's3', 'azure', 'database'].includes(provider)) throw new Error('Set TARGET_STORAGE_PROVIDER (r2 | s3 | azure | database)');
  return {
    ...base, provider,
    bucket: e.TARGET_STORAGE_BUCKET ?? '', region: e.TARGET_STORAGE_REGION ?? 'auto', endpoint: (e.TARGET_STORAGE_ENDPOINT ?? '').replace(/\/+$/, ''),
    forcePathStyle: (e.TARGET_STORAGE_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: e.TARGET_STORAGE_ACCESS_KEY_ID ?? '', secretAccessKey: e.TARGET_STORAGE_SECRET_ACCESS_KEY ?? '',
    azureAccount: e.TARGET_STORAGE_AZURE_ACCOUNT ?? '', azureAccountKey: e.TARGET_STORAGE_AZURE_ACCOUNT_KEY ?? '',
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 100_000;

  const env = loadEnv();
  const config = buildAppConfig(env);
  const pool = new Pool({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, max: 2 });
  // Minimal DatabaseService facade for the 'database' provider (dev) — RLS bypassed for this admin script.
  const db = {
    query: async (text: string, params: unknown[]): Promise<unknown[]> => (await pool.query<Record<string, unknown>>(text, params)).rows,
    queryOne: async (text: string, params: unknown[]): Promise<unknown> => (await pool.query<Record<string, unknown>>(text, params)).rows[0] ?? null,
    execute_: async (text: string, params: unknown[]) => (await pool.query(text, params)).rowCount ?? 0,
  } as unknown as DatabaseService;

  const source = createStorage(config.storage, db);
  const target = createStorage(targetSettings(config.storage), db);
  if (source.provider === target.provider && source.bucket === target.bucket) throw new Error('Source and target are the same');

  const rows = (await pool.query<{ id: string; tenant_id: string; object_key: string; sha256: string; mime_type: string; visibility: string; file_name: string }>(
    `SELECT id, tenant_id, object_key, sha256, mime_type, visibility, file_name FROM stored_files
      WHERE provider = $1 AND bucket = $2 AND deleted_at IS NULL ORDER BY created_at LIMIT $3`,
    [source.provider, source.bucket, limit],
  )).rows;
  process.stdout.write(`${rows.length} file(s) on ${source.provider}:${source.bucket} → ${target.provider}:${target.bucket}${dryRun ? ' (dry run)' : ''}\n`);

  let moved = 0;
  const failed: { id: string; key: string; error: string }[] = [];
  for (const r of rows) {
    try {
      await runWithContext(createContext({ tenantId: r.tenant_id as TenantId, actorType: 'system' }), async () => {
        const bytes = await source.get(r.object_key);
        if (!bytes) throw new Error('missing on source');
        if (createHash('sha256').update(bytes).digest('hex') !== r.sha256) throw new Error('source checksum mismatch — NOT copied');
        if (dryRun) return;
        await target.put(r.object_key, bytes, {
          contentType: r.mime_type,
          cacheControl: r.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
          contentDisposition: `inline; filename="${r.file_name.replace(/["\\\r\n]/g, '_')}"`,
        });
        const back = await target.get(r.object_key);
        if (!back || createHash('sha256').update(back).digest('hex') !== r.sha256) throw new Error('target verification failed');
        await pool.query(`UPDATE stored_files SET provider = $2, bucket = $3 WHERE id = $1 AND provider = $4`, [r.id, target.provider, target.bucket, source.provider]);
      });
      moved += 1;
      if (moved % 100 === 0) process.stdout.write(`  ...${moved}\n`);
    } catch (e) {
      failed.push({ id: r.id, key: r.object_key, error: (e as Error).message });
    }
  }
  process.stdout.write(`✓ ${dryRun ? 'verified' : 'moved'} ${moved}, failed ${failed.length}\n`);
  for (const f of failed.slice(0, 50)) process.stdout.write(`  ✖ ${f.key}: ${f.error}\n`);
  if (failed.length) process.exitCode = 1;
  await pool.end();
}

void main();
