/**
 * Drop and recreate the working schema, then migrate + seed. DEV/TEST ONLY —
 * refuses to run against a production NODE_ENV as a guard against catastrophe.
 */
import { Pool } from 'pg';

import { loadEnv } from '@config';

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.NODE_ENV === 'production') {
    process.stderr.write('✖ Refusing to reset the database in production\n');
    process.exit(1);
  }
  const pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: 1,
  });
  await pool.query(`DROP SCHEMA IF EXISTS ${env.DB_SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${env.DB_SCHEMA}`);
  await pool.end();
  process.stdout.write(`✓ schema '${env.DB_SCHEMA}' reset — run npm run db:migrate next\n`);
}

void main();
