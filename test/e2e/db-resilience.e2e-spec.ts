import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildAppConfig, loadEnv } from '@config';
import { createPool, type NamedPool } from '@database';
import type { Logger } from '@observability';

/**
 * A connection the server kills while it is checked out (an
 * idle-in-transaction timeout, an admin's pg_terminate_backend, a failover)
 * must fail that one query — never crash the process. The pool only listens
 * for errors on idle clients; a busy client's 'error' with no listener was an
 * uncaught exception that shut the whole API down.
 */
describe('database pool: a killed connection (e2e)', () => {
  let pool: NamedPool;
  const logged: string[] = [];
  const logger = {
    error: (_e: unknown, msg: string) => logged.push(msg),
    debug: () => undefined,
  } as unknown as Logger;

  beforeAll(() => {
    const config = buildAppConfig(loadEnv());
    pool = createPool(config, {
      name: 'resilience-test',
      role: 'primary',
      host: config.db.host,
      port: config.db.port,
      logger,
    });
  });
  afterAll(async () => {
    await pool.pool.end();
  });

  it('fails the query on that connection and keeps the process alive', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (e: unknown) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);
    try {
      const victim = await pool.pool.connect();
      await victim.query('BEGIN');
      const { rows } = await victim.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const killer = await pool.pool.connect();
      await killer.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
      killer.release();

      await new Promise((r) => setTimeout(r, 200));
      await expect(victim.query('SELECT 1')).rejects.toThrow();
      victim.release(true);

      expect(uncaught).toEqual([]);
      expect(logged).toContain('Database client error');
      // The pool still serves new work.
      const again = await pool.pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(again.rows[0].ok).toBe(1);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});
