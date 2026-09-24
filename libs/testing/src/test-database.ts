import { Pool, type PoolClient } from 'pg';

import { loadEnv } from '@config';
import { runWithContext, createContext, type TenantId } from '@kernel';

/**
 * Integration-test database harness.
 *
 * STRATEGY: every test runs inside a transaction that is ROLLED BACK at the
 * end. No test ever commits, so:
 *  - tests are perfectly isolated with zero cleanup code;
 *  - they run in any order and in parallel (each gets its own connection);
 *  - the database is never left dirty, even if a test throws.
 *
 * This is dramatically faster and more reliable than truncating tables between
 * tests, and it exercises the real schema, real constraints and real RLS
 * policies — which a mocked repository never would.
 */
export class TestDatabase {
  private pool!: Pool;

  async connect(): Promise<void> {
    const env = loadEnv();
    this.pool = new Pool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      max: 4,
    });
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  /**
   * Run `fn` against a connection inside a transaction bound to `tenantId`,
   * then roll everything back. The ambient request context is set too, so code
   * that calls `requireTenantId()` works exactly as in production.
   */
  async withRollback<T>(
    tenantId: TenantId | null,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      const context = createContext({ tenantId: tenantId ?? undefined, actorType: 'system' });
      return await runWithContext(context, () => fn(client));
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  raw(): Pool {
    return this.pool;
  }
}
