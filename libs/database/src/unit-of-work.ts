import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { AppConfig } from '@config';
import { getTenantId, newId, sleep, type DomainEvent, type TenantId } from '@kernel';
import { Logger, Metrics } from '@observability';

import { DatabaseService } from './database.service';
import { isRetryablePgError, mapPostgresError } from './pg-error';
import {
  currentTransaction,
  runInTransactionScope,
  type IsolationLevel,
  type TransactionScope,
} from './transaction-context';
import { bindTenantLocal, bypassRlsLocal } from './tenant-session';

export interface TransactionOptions {
  /** Metrics/log label, e.g. `booking.confirm`. */
  name: string;
  isolation?: IsolationLevel;
  readOnly?: boolean;
  /** Tenant to bind for RLS; defaults to the ambient context. */
  tenantId?: TenantId | null;
  /** Platform-admin operations only. Audited by the caller. */
  bypassRls?: boolean;
  /** Retries on serialization failure / deadlock. */
  maxRetries?: number;
  /** Statement timeout for every statement inside this transaction. */
  statementTimeoutMs?: number;
  /**
   * `deferrable` + `serializable` + `read only` gives a snapshot that never
   * aborts — ideal for long reporting reads that must be internally consistent.
   */
  deferrable?: boolean;
}

/**
 * ============================================================================
 *  Unit of Work
 * ============================================================================
 *
 * One transaction per use case. The rules this enforces:
 *
 *  1. **One connection.** Everything inside `run()` shares the scope's client.
 *     Nested `run()` calls become SAVEPOINTs, never a second connection — the
 *     classic way to deadlock your own pool under load.
 *
 *  2. **Automatic retry on write conflicts.** `serializable` and
 *     `repeatable read` transactions can abort with 40001; that is normal and
 *     expected, not an error. We retry with full jitter. This is what lets the
 *     seat-hold path in Part 7 use a strict isolation level without the caller
 *     writing retry loops.
 *     NOTE: the callback must therefore be *idempotent* — no side effects
 *     outside the database. That is exactly what `onCommit()` is for.
 *
 *  3. **Atomic domain events.** Events recorded via `recordEvent()` are written
 *     to `outbox_events` in the same COMMIT. No dual-write, no lost
 *     notifications, no notifications for rolled-back bookings.
 *
 *  4. **Side effects after commit only.** Cache invalidation, webhooks and
 *     metrics registered with `onCommit()` run once the data is durable.
 */
@Injectable()
export class UnitOfWork {
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('UnitOfWork');
  }

  /**
   * Run `fn` inside a transaction. Joins an outer transaction as a SAVEPOINT
   * when one is already open.
   */
  async run<T>(
    options: TransactionOptions,
    fn: (scope: TransactionScope) => Promise<T>,
  ): Promise<T> {
    const existing = currentTransaction();
    if (existing) return this.runNested(existing, options, fn);

    const maxRetries = options.maxRetries ?? (options.isolation === 'read committed' ? 0 : 3);

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.runRoot(options, fn);
      } catch (error) {
        const retryable = isRetryablePgError(error);
        if (!retryable || attempt >= maxRetries)
          throw mapPostgresError(error, { meta: { transaction: options.name } });

        const reason = (error as { code?: string }).code ?? 'unknown';
        this.metrics.dbTransactionRetries.inc({ reason });
        const delay = Math.random() * Math.min(200, 10 * 2 ** attempt); // full jitter
        this.log.warn(
          { transaction: options.name, attempt: attempt + 1, reason, delayMs: Math.round(delay) },
          'retrying transaction after write conflict',
        );
        await sleep(delay);
      }
    }
  }

  /** Convenience: a read-only, repeatable-read transaction for consistent reads. */
  async readConsistent<T>(name: string, fn: (scope: TransactionScope) => Promise<T>): Promise<T> {
    return this.run({ name, isolation: 'repeatable read', readOnly: true, deferrable: true }, fn);
  }

  /* ── internals ────────────────────────────────────────────────────────*/

  private async runRoot<T>(
    options: TransactionOptions,
    fn: (scope: TransactionScope) => Promise<T>,
  ): Promise<T> {
    const client: PoolClient = await this.db.primary.pool.connect();
    const scope: TransactionScope = {
      client,
      id: newId(),
      startedAt: Date.now(),
      tenantId: options.tenantId !== undefined ? options.tenantId : (getTenantId() ?? null),
      isolation: options.isolation ?? 'read committed',
      readOnly: options.readOnly ?? false,
      depth: 0,
      events: [],
      afterCommit: [],
      afterRollback: [],
    };

    try {
      await client.query(buildBeginStatement(scope, options));

      if (options.statementTimeoutMs !== undefined) {
        await client.query(`SET LOCAL statement_timeout = ${Number(options.statementTimeoutMs)}`);
      }
      if (options.bypassRls) await bypassRlsLocal(client);
      await bindTenantLocal(client, scope.tenantId);

      const result = await runInTransactionScope(scope, () => fn(scope));

      // Outbox rows join the SAME commit as the state change. This is the whole
      // point of the pattern: state and its notification are one atomic fact.
      if (scope.events.length > 0) await this.flushOutbox(client, scope);

      await client.query('COMMIT');
      this.observe(options.name, scope, 'commit');
      await runCallbacks(scope.afterCommit, this.log, 'afterCommit');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        this.log.error(rollbackError, 'rollback failed', { transaction: options.name });
      }
      this.observe(options.name, scope, 'rollback');
      await runCallbacks(scope.afterRollback, this.log, 'afterRollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Nested unit of work → SAVEPOINT. The inner block can fail and be rolled
   * back without destroying the outer transaction, which is how the booking
   * saga attempts an optional step (e.g. applying a coupon) without risking
   * the whole booking.
   */
  private async runNested<T>(
    scope: TransactionScope,
    options: TransactionOptions,
    fn: (scope: TransactionScope) => Promise<T>,
  ): Promise<T> {
    if (options.isolation && options.isolation !== scope.isolation) {
      this.log.warn(
        { requested: options.isolation, active: scope.isolation, transaction: options.name },
        'nested transaction requested a different isolation level; the outer level wins',
      );
    }

    scope.depth += 1;
    const savepoint = `sp_${scope.depth}_${options.name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 24)}`;
    await scope.client.query(`SAVEPOINT ${savepoint}`);
    try {
      const result = await fn(scope);
      await scope.client.query(`RELEASE SAVEPOINT ${savepoint}`);
      return result;
    } catch (error) {
      await scope.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      throw error;
    } finally {
      scope.depth -= 1;
    }
  }

  /**
   * Bulk-insert queued events with a single multi-row INSERT. One statement
   * regardless of event count keeps commit latency flat.
   */
  private async flushOutbox(client: PoolClient, scope: TransactionScope): Promise<void> {
    const events = scope.events;
    const columns = 9;
    const values: unknown[] = [];
    const placeholders: string[] = [];

    events.forEach((event: DomainEvent, index) => {
      const offset = index * columns;
      placeholders.push(
        `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9})`,
      );
      values.push(
        event.eventId,
        event.tenantId ?? scope.tenantId,
        event.type,
        event.version,
        event.aggregateType,
        event.aggregateId,
        JSON.stringify(event.payload),
        event.correlationId ?? null,
        event.occurredAt,
      );
    });

    await client.query(
      `INSERT INTO outbox_events
         (id, tenant_id, event_type, event_version, aggregate_type, aggregate_id, payload, correlation_id, occurred_at)
       VALUES ${placeholders.join(',')}`,
      values,
    );
  }

  private observe(name: string, scope: TransactionScope, outcome: 'commit' | 'rollback'): void {
    const durationMs = Date.now() - scope.startedAt;
    this.metrics.dbQueries.inc({ operation: `tx:${name}`, target: 'primary', outcome });
    this.metrics.dbDuration.observe(
      { operation: `tx:${name}`, target: 'primary' },
      durationMs / 1000,
    );

    // A long-running transaction holds locks and blocks vacuum. Surface it.
    if (durationMs > this.config.db.idleInTransactionTimeoutMs / 2) {
      this.log.warn(
        { transaction: name, durationMs, outcome, events: scope.events.length },
        'long transaction',
      );
    }
  }
}

function buildBeginStatement(scope: TransactionScope, options: TransactionOptions): string {
  const parts = ['BEGIN'];
  parts.push(`ISOLATION LEVEL ${scope.isolation.toUpperCase()}`);
  parts.push(scope.readOnly ? 'READ ONLY' : 'READ WRITE');
  if (options.deferrable && scope.readOnly && scope.isolation === 'serializable') {
    parts.push('DEFERRABLE');
  }
  return parts.join(' ');
}

async function runCallbacks(
  callbacks: (() => void | Promise<void>)[],
  log: Logger,
  phase: string,
): Promise<void> {
  for (const callback of callbacks) {
    try {
      await callback();
    } catch (error) {
      // A failed cache invalidation must never fail an already-committed
      // booking. Log it; the cache TTL is the backstop.
      log.error(error, `${phase} callback failed`);
    }
  }
}
