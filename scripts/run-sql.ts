/**
 * Runs a raw .sql file against DATABASE_URL using the SAME `pg` client
 * seed.ts already depends on — this REPLACES needing `psql` on PATH, which
 * isn't there by default on a fresh Windows install (seed.ts's own
 * runSqlFile() helper does exactly this already; this is that same idea
 * exposed as a standalone command for the seed files that used to be
 * invoked via `psql -f`).
 *
 * Usage: tsx scripts/run-sql.ts db/seeds/geography.seed.sql
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import { loadEnv } from '@config';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('Usage: tsx scripts/run-sql.ts <path-to-sql-file>\n');
    process.exitCode = 1;
    return;
  }
  const env = loadEnv();
  const sql = readFileSync(resolve(file), 'utf8');
  const pool = new Pool({ host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, max: 1 });
  const client = await pool.connect();
  try {
    process.stdout.write(`→ running ${file}\n`);
    await client.query(sql);
    process.stdout.write(`✓ done\n`);
  } catch (error) {
    process.stderr.write(`✖ ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
