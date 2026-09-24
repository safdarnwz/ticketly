import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

import { AppConfig } from '@config';
import { getTenantId, ServiceUnavailableError, type TenantId } from '@kernel';
import { Logger, Metrics, startTimer } from '@observability';

import { mapPostgresError } from './pg-error';
import { createPool, observePool, type NamedPool } from './pool';
import { bindTenant } from './tenant-session';
import { currentTransaction } from './transaction-context';

/**
 * ============================================================================
 *  DatabaseService — the single door to Postgres
 * ============================================================================
 *
 * Responsibilities:
 *  - own the primary and replica pools;
 *  - route reads to replicas and writes to the primary, while making a read
 *    inside an open transaction stay on that transaction's connection
 *    (read-your-own-writes is non-negotiable inside a booking saga);
 *  - bind the RLS tenant GUC;
 *  - time, count and slow-log every statement;
 *  - translate Postgres errors into the error kernel.
 *
 * REPLICA ROUTING RULES (enforced by review, documented here):
 *  ✓ search, availability listings, reports, exports, master-data reads
 *  ✗ anything that will be used to make a write decision
 *  ✗ anything read immediately after a write in the same request
 * When in doubt, use `readPrimary()`. Replication lag is measured and a replica
 * that falls behind `DB_REPLICA_MAX_LAG_MS` is removed from rotation.
 */

export interface QueryOptions {
  /** Label for metrics/tracing, e.g. `trips.searchAvailability`. Low cardinality. */
  name: string;
  /** Force the primary even for a read. */
  primary?: boolean;
  /** Override the tenant to bind (defaults to the ambient request context). */
  tenantId?: TenantId | null;
  /** Per-statement timeout override in ms. */
  timeoutMs?: number;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private primaryPool!: NamedPool;
  private replicaPools: NamedPool[] = [];
  private healthyReplicas: NamedPool[] = [];
  private roundRobin = 0;
  private poolMetricsTimer?: NodeJS.Timeout;
  private replicaHealthTimer?: NodeJS.Timeout;
  private readonly log: Logger;
  private shuttingDown = false;

  constructor(
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('DatabaseService');
  }

  async onModuleInit(): Promise<void> {
    this.primaryPool = createPool(this.config, {
      name: 'primary',
      role: 'primary',
      host: this.config.db.host,
      port: this.config.db.port,
      logger: this.log,
    });

    this.replicaPools = this.config.db.replicas.map((replica, index) =>
      createPool(this.config, {
        name: `replica-${index}`,
        role: 'replica',
        host: replica.host,
        port: replica.port,
        logger: this.log,
      }),
    );
    this.healthyReplicas = [...this.replicaPools];

    // Fail fast at boot rather than on the first customer request.
    const probe = await this.primaryPool.pool.connect();
    try {
      const { rows } = await probe.query<{ version: string }>('SELECT version()');
      this.log.info(
        { replicas: this.replicaPools.length, server: rows[0]?.version?.split(',')[0] },
        'database connected',
      );
    } finally {
      probe.release();
    }

    this.poolMetricsTimer = setInterval(() => {
      observePool([this.primaryPool, ...this.replicaPools], this.metrics);
    }, 5_000).unref();

    if (this.replicaPools.length > 0) {
      this.replicaHealthTimer = setInterval(() => {
        void this.checkReplicaHealth();
      }, this.config.db.replicaHealthcheckIntervalMs).unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.poolMetricsTimer) clearInterval(this.poolMetricsTimer);
    if (this.replicaHealthTimer) clearInterval(this.replicaHealthTimer);
    await Promise.allSettled([this.primaryPool, ...this.replicaPools].map((p) => p.pool.end()));
    this.log.info('database pools closed');
  }

  /* ── query surface ─────────────────────────────────────────────────────*/

  /**
   * Execute a parameterised statement. This is the ONLY place raw SQL touches
   * the driver, so instrumentation and error mapping cannot be bypassed.
   *
   * SQL is always written with `$1, $2 …` placeholders. String interpolation of
   * values into SQL is banned by ESLint (`no-restricted-syntax`).
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
    options: QueryOptions,
  ): Promise<T[]> {
    const result = await this.execute<T>(text, params, options);
    return result.rows;
  }

  /** Same as `query` but returns exactly one row or null. */
  async queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
    options: QueryOptions,
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params, options);
    return rows[0] ?? null;
  }

  /** Execute a statement and return the affected row count. */
  async execute_(
    text: string,
    params: readonly unknown[] = [],
    options: QueryOptions,
  ): Promise<number> {
    const result = await this.execute(text, params, { ...options, primary: true });
    return result.rowCount ?? 0;
  }

  private async execute<T extends QueryResultRow>(
    text: string,
    params: readonly unknown[],
    options: QueryOptions,
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    if (this.shuttingDown) {
      throw new ServiceUnavailableError('Server is shutting down');
    }

    const tx = currentTransaction();
    const usePrimary = options.primary === true || tx !== undefined;
    const stopTimer = startTimer();
    const target = usePrimary ? 'primary' : 'replica';

    try {
      let result: { rows: T[]; rowCount: number | null };

      if (tx) {
        // Inside a unit of work: reuse its client so we see uncommitted state
        // and hold no second connection (a classic pool-deadlock source).
        result = await tx.client.query<T>(text, params as unknown[]);
      } else {
        result = await this.withClient(usePrimary, options, (client) =>
          client.query<T>(text, params as unknown[]),
        );
      }

      const seconds = stopTimer();
      this.metrics.dbQueries.inc({ operation: options.name, target, outcome: 'ok' });
      this.metrics.dbDuration.observe({ operation: options.name, target }, seconds);
      this.maybeLogSlow(options.name, text, seconds, result.rowCount);
      return result;
    } catch (error) {
      this.metrics.dbQueries.inc({ operation: options.name, target, outcome: 'error' });
      this.metrics.dbDuration.observe({ operation: options.name, target }, stopTimer());
      throw mapPostgresError(error, { meta: { operation: options.name } });
    }
  }

  /**
   * Lease a client, bind the tenant, run `fn`, always release.
   * Used by `execute` and by anything needing several statements on one
   * connection (COPY, cursors, advisory locks).
   */
  async withClient<T>(
    usePrimary: boolean,
    options: Pick<QueryOptions, 'tenantId' | 'timeoutMs'>,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = usePrimary ? this.primaryPool : this.pickReplica();
    const client = await pool.pool.connect();
    try {
      const tenantId = options.tenantId !== undefined ? options.tenantId : (getTenantId() ?? null);
      await bindTenant(client, tenantId);
      if (options.timeoutMs !== undefined) {
        await client.query(`SET LOCAL statement_timeout = ${Number(options.timeoutMs)}`);
      }
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /** Explicit primary-read escape hatch for read-after-write paths. */
  async readPrimary<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[],
    options: Omit<QueryOptions, 'primary'>,
  ): Promise<T[]> {
    return this.query<T>(text, params, { ...options, primary: true });
  }

  /* ── pool access (used by the unit of work and migrator) ───────────────*/

  get primary(): NamedPool {
    return this.primaryPool;
  }

  get replicas(): NamedPool[] {
    return this.replicaPools;
  }

  async ping(): Promise<boolean> {
    try {
      await this.query('SELECT 1 AS ok', [], { name: 'health.ping', primary: true });
      return true;
    } catch {
      return false;
    }
  }

  /* ── internals ────────────────────────────────────────────────────────*/

  private pickReplica(): NamedPool {
    if (this.healthyReplicas.length === 0) return this.primaryPool;
    // Round-robin. A least-connections strategy is measurably better under
    // heterogeneous replicas; swap it in here if replicas ever differ in size.
    this.roundRobin = (this.roundRobin + 1) % this.healthyReplicas.length;
    return this.healthyReplicas[this.roundRobin];
  }

  private async checkReplicaHealth(): Promise<void> {
    const maxLagMs = this.config.db.replicaMaxLagMs;
    const healthy: NamedPool[] = [];

    for (const replica of this.replicaPools) {
      try {
        const client = await replica.pool.connect();
        try {
          const { rows } = await client.query<{ lag_ms: number | null }>(
            `SELECT CASE
                      WHEN pg_is_in_recovery() THEN
                        EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000
                      ELSE 0
                    END AS lag_ms`,
          );
          const lag = rows[0]?.lag_ms ?? 0;
          if (lag !== null && lag <= maxLagMs) {
            healthy.push(replica);
          } else {
            this.log.warn(
              { replica: replica.name, lagMs: lag },
              'replica lag exceeded; removed from rotation',
            );
          }
        } finally {
          client.release();
        }
      } catch (error) {
        this.log.error(error, 'replica health check failed', { replica: replica.name });
      }
    }

    if (healthy.length === 0 && this.replicaPools.length > 0) {
      this.log.warn('no healthy replicas; all reads will use the primary');
    }
    this.healthyReplicas = healthy;
  }

  private maybeLogSlow(name: string, text: string, seconds: number, rowCount: number | null): void {
    const ms = seconds * 1000;
    if (this.config.db.logQueries) {
      this.log.debug({ operation: name, ms: Math.round(ms), rowCount }, 'query');
      return;
    }
    if (ms >= this.config.db.slowQueryMs) {
      // Parameters are intentionally omitted — they routinely contain PII.
      this.log.warn(
        { operation: name, ms: Math.round(ms), rowCount, sql: compactSql(text) },
        'slow query',
      );
    }
  }
}

function compactSql(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}
