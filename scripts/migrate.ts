/**
 * Migration CLI.  Usage:
 *   npm run db:migrate            # apply all pending
 *   npm run db:migrate:down       # revert the last one (add a number to revert N)
 *   npm run db:migrate:status     # show applied vs pending
 *
 * Runs standalone (no Nest container) so it can be invoked from a deploy step,
 * a systemd `ExecStartPre`, or CI, before the app itself boots.
 */
import { resolve } from 'node:path';

import { Pool } from 'pg';

import { loadEnv } from '@config';
import {
  appliedMigrations,
  ensureMigrationTable,
  loadMigrations,
  migrateDown,
  migrateUp,
} from '@database';

const MIGRATIONS_DIR = resolve(__dirname, '../db/migrations');

async function main(): Promise<void> {
  const env = loadEnv();
  const command = process.argv[2] ?? 'up';

  const pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } : undefined,
    // A migration that builds an index on a big table can run for minutes.
    statement_timeout: 0,
    max: 1,
  });

  const client = await pool.connect();
  const log = (message: string): void => {
    process.stdout.write(`${message}\n`);
  };

  try {
    const files = await loadMigrations(MIGRATIONS_DIR);

    if (command === 'up') {
      const result = await migrateUp(client, files, log);
      log(
        result.applied.length === 0
          ? '✓ database already up to date'
          : `✓ applied ${result.applied.length} migration(s)`,
      );
    } else if (command === 'down') {
      const steps = Number(process.argv[3] ?? '1');
      const reverted = await migrateDown(client, files, steps, log);
      log(`✓ reverted ${reverted.length} migration(s)`);
    } else if (command === 'status') {
      await ensureMigrationTable(client);
      const applied = await appliedMigrations(client);
      log('\nMigration status:');
      log('─'.repeat(60));
      for (const file of files) {
        const record = applied.get(file.name);
        const mark = record ? '✓ applied' : '· pending';
        const when = record ? record.applied_at.toISOString() : '';
        log(`  ${mark}  ${file.name.padEnd(40)} ${when}`);
      }
      const pending = files.filter((f) => !applied.has(f.name)).length;
      log('─'.repeat(60));
      log(`  ${applied.size} applied, ${pending} pending\n`);
    } else {
      log(`Unknown command '${command}'. Use: up | down [n] | status`);
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`\n✖ Migration failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
