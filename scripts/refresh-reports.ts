/**
 * Refreshes the reporting materialised views (mv_trip_daily,
 * mv_operator_revenue_daily, mv_route_performance) on demand. These were
 * created WITH NO DATA — querying any of them before a first refresh throws
 * "materialized view has not been populated". In production a worker
 * scheduler calls refresh_reporting_views() periodically; run this any time
 * Reports pages error out on freshly-seeded/imported data and you don't
 * want to wait for (or don't have) the worker running.
 */
import { Pool } from 'pg';

import { loadEnv } from '@config';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = new Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('SELECT refresh_reporting_views()');
    process.stdout.write('✓ Reporting views refreshed\n');
  } catch (error) {
    process.stderr.write(`✖ ${(error as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
