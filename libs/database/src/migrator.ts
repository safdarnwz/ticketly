import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join as joinPath, resolve } from 'node:path';

import type { PoolClient } from 'pg';

/**
 * ============================================================================
 *  Migration runner
 * ============================================================================
 *
 * Plain `.sql` files, applied in filename order, tracked in `schema_migrations`.
 * No ORM-generated migrations, no auto-sync — the schema is a reviewed artefact.
 *
 * PROPERTIES THAT MATTER IN PRODUCTION:
 *
 *  - **Advisory lock.** Two API instances booting simultaneously would
 *    otherwise both try to migrate. `pg_advisory_lock` makes one wait.
 *  - **Checksums.** If a already-applied file is edited, the runner refuses to
 *    start. Editing applied migrations is how staging and production silently
 *    diverge.
 *  - **Per-file transaction, opt-out supported.** Postgres DDL is
 *    transactional, so each migration commits atomically. A file may start with
 *    `-- migrate:no-transaction` for statements that cannot run in one
 *    (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE`).
 *  - **`-- migrate:up` / `-- migrate:down` sections** so a bad deploy can be
 *    reversed.
 *
 * ZERO-DOWNTIME RULES (enforced in review, see docs/DATABASE.md):
 *  expand → migrate data → contract, never rename in place, always add columns
 *  nullable-or-defaulted first, always build indexes CONCURRENTLY on hot tables.
 */

const MIGRATION_LOCK_ID = 8_734_251_009_112n;

export interface MigrationFile {
  name: string;
  up: string;
  down: string;
  checksum: string;
  useTransaction: boolean;
}

export interface MigrationRecord {
  name: string;
  checksum: string;
  applied_at: Date;
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const directory = resolve(dir);
  const entries = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();

  const files: MigrationFile[] = [];
  for (const entry of entries) {
    const content = await readFile(joinPath(directory, entry), 'utf8');
    files.push({
      name: entry,
      ...splitSections(content),
      checksum: createHash('sha256').update(content).digest('hex'),
      useTransaction: !/^--\s*migrate:no-transaction/m.test(content),
    });
  }
  return files;
}

function splitSections(content: string): { up: string; down: string } {
  const upMatch = /--\s*migrate:up\b([\s\S]*?)(?=--\s*migrate:down\b|$)/i.exec(content);
  const downMatch = /--\s*migrate:down\b([\s\S]*)$/i.exec(content);
  return {
    up: (upMatch ? upMatch[1] : content).trim(),
    down: (downMatch ? downMatch[1] : '').trim(),
  };
}

export async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0
    )
  `);
}

export async function appliedMigrations(client: PoolClient): Promise<Map<string, MigrationRecord>> {
  const { rows } = await client.query<MigrationRecord>(
    'SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name',
  );
  return new Map(rows.map((row) => [row.name, row]));
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function migrateUp(
  client: PoolClient,
  files: MigrationFile[],
  log: (message: string) => void = () => {},
): Promise<MigrateResult> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID.toString()]);
  try {
    await ensureMigrationTable(client);
    const applied = await appliedMigrations(client);
    const result: MigrateResult = { applied: [], skipped: [] };

    for (const file of files) {
      const record = applied.get(file.name);
      if (record) {
        if (record.checksum !== file.checksum) {
          throw new Error(
            `Migration '${file.name}' was modified after it was applied ` +
              `(expected checksum ${record.checksum}, found ${file.checksum}). ` +
              `Never edit an applied migration — add a new one.`,
          );
        }
        result.skipped.push(file.name);
        continue;
      }

      const started = Date.now();
      log(`→ applying ${file.name}`);

      if (file.useTransaction) {
        await client.query('BEGIN');
        try {
          await client.query(file.up);
          await recordApplied(client, file, Date.now() - started);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(`Migration '${file.name}' failed: ${(error as Error).message}`, {
            cause: error,
          });
        }
      } else {
        // Non-transactional: the statement itself is atomic (e.g. CREATE INDEX
        // CONCURRENTLY). If it fails midway the operator must clean up — the
        // file should therefore be written idempotently (IF NOT EXISTS).
        await client.query(file.up);
        await recordApplied(client, file, Date.now() - started);
      }

      log(`✓ applied ${file.name} in ${Date.now() - started}ms`);
      result.applied.push(file.name);
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID.toString()]);
  }
}

export async function migrateDown(
  client: PoolClient,
  files: MigrationFile[],
  steps = 1,
  log: (message: string) => void = () => {},
): Promise<string[]> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID.toString()]);
  try {
    await ensureMigrationTable(client);
    const applied = await appliedMigrations(client);
    const toRevert = files
      .filter((file) => applied.has(file.name))
      .slice(-steps)
      .reverse();

    const reverted: string[] = [];
    for (const file of toRevert) {
      if (!file.down) throw new Error(`Migration '${file.name}' has no '-- migrate:down' section`);
      log(`← reverting ${file.name}`);
      await client.query('BEGIN');
      try {
        await client.query(file.down);
        await client.query('DELETE FROM schema_migrations WHERE name = $1', [file.name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      reverted.push(file.name);
    }
    return reverted;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID.toString()]);
  }
}

async function recordApplied(
  client: PoolClient,
  file: MigrationFile,
  durationMs: number,
): Promise<void> {
  await client.query(
    `INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)
     ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum`,
    [file.name, file.checksum, durationMs],
  );
}
