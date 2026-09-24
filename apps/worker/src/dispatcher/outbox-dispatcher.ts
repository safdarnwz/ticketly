import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { AppConfig } from '@config';
import { DatabaseService } from '@database';
import {
  createContext,
  runWithContext,
  sleep,
  type DomainEvent,
  type TenantId,
  type Uuid,
} from '@kernel';
import { Logger, Metrics } from '@observability';

import { EventDispatcher } from './event-dispatcher';

/**
 * ============================================================================
 *  Outbox dispatcher — at-least-once delivery of domain events
 * ============================================================================
 *
 * The other half of the transactional-outbox pattern (Part 1 writes events into
 * `outbox_events` inside the business transaction; this drains them). It is the
 * mechanism that makes "on booking.confirmed, send a WhatsApp / update
 * analytics / notify the OTA" actually happen, reliably, without the booking
 * transaction ever calling those systems directly.
 *
 * HOW IT ACHIEVES RELIABILITY:
 *
 *  - **FOR UPDATE SKIP LOCKED** — the claim query locks a batch of pending rows
 *    and skips any a sibling worker already holds. This lets N workers drain the
 *    same table CONCURRENTLY with zero coordination and zero double-processing.
 *    It is the canonical Postgres work-queue pattern.
 *
 *  - **At-least-once, not exactly-once** — a worker can crash after handling an
 *    event but before marking it delivered, so a handler MAY see an event twice.
 *    Every handler is therefore idempotent (the notification log's unique
 *    constraint is the concrete example).
 *
 *  - **Exponential backoff + dead-letter** — a failing event is retried with
 *    growing delay (`available_at`); after `OUTBOX_MAX_ATTEMPTS` it is moved to
 *    `dead` so one poison event can't block the queue forever. Dead events are
 *    alerted on, not silently dropped.
 *
 *  - **Runs in the worker process**, not the API — a slow SMS provider can never
 *    consume the request-handling event loop.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private timer?: NodeJS.Timeout;
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
    private readonly dispatcher: EventDispatcher,
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('OutboxDispatcher');
  }

  onModuleInit(): void {
    if (!this.config.worker.enabled) {
      this.log.info('worker disabled; outbox dispatcher not started');
      return;
    }
    this.running = true;
    void this.loop();
    this.log.info({ batchSize: this.config.worker.outboxBatchSize }, 'outbox dispatcher started');
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const processed = await this.drainBatch();
        // Idle backoff: if there was nothing to do, wait the poll interval;
        // if we processed a full batch, loop immediately (there may be more).
        if (processed === 0) await sleep(this.config.worker.outboxPollIntervalMs);
      } catch (error) {
        this.log.error(error, 'outbox loop iteration failed');
        await sleep(this.config.worker.outboxPollIntervalMs * 5);
      }
    }
  }

  /** Claim and process one batch. Returns how many rows were handled. */
  private async drainBatch(): Promise<number> {
    return this.db.withClient(true, {}, async (client) => {
      await client.query('BEGIN');
      try {
        // Claim: lock pending, due rows, skipping ones other workers hold.
        const claimed = await client.query<OutboxRow>(
          `SELECT id, tenant_id, event_type, event_version, aggregate_type, aggregate_id,
                  payload, correlation_id, occurred_at, attempts
             FROM outbox_events
            WHERE status = 'pending' AND available_at <= now()
            ORDER BY available_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT $1`,
          [this.config.worker.outboxBatchSize],
        );

        if (claimed.rows.length === 0) {
          await client.query('COMMIT');
          return 0;
        }

        // Mark claimed rows 'processing' so a crash mid-batch is visible.
        const ids = claimed.rows.map((r) => r.id);
        await client.query(`UPDATE outbox_events SET status = 'processing' WHERE id = ANY($1)`, [
          ids,
        ]);
        await client.query('COMMIT');

        // Process each event OUTSIDE the claim transaction (handlers do their
        // own writes; holding the claim lock while calling an SMS provider would
        // be a disaster).
        for (const row of claimed.rows) {
          await this.processOne(row);
        }
        return claimed.rows.length;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  private async processOne(row: OutboxRow): Promise<void> {
    const event = this.toEvent(row);
    const context = createContext({
      tenantId: (row.tenant_id ?? undefined) as TenantId | undefined,
      correlationId: row.correlation_id ?? undefined,
      actorType: 'system',
    });

    try {
      await runWithContext(context, () => this.dispatcher.dispatch(event));
      await this.db.query(
        `UPDATE outbox_events SET status = 'delivered', processed_at = now() WHERE id = $1`,
        [row.id],
        { name: 'outbox.markDelivered', primary: true },
      );
      this.metrics.jobRuns.inc({ job: 'outbox', outcome: 'ok' });
    } catch (error) {
      await this.handleFailure(row, error);
    }
  }

  private async handleFailure(row: OutboxRow, error: unknown): Promise<void> {
    const attempts = row.attempts + 1;
    const message = (error as Error)?.message ?? String(error);

    if (attempts >= this.config.worker.outboxMaxAttempts) {
      // Dead-letter: stop retrying, alert.
      await this.db.query(
        `UPDATE outbox_events SET status = 'dead', attempts = $2, last_error = $3, processed_at = now() WHERE id = $1`,
        [row.id, attempts, message],
        { name: 'outbox.deadLetter', primary: true },
      );
      this.metrics.jobRuns.inc({ job: 'outbox', outcome: 'dead' });
      this.log.error(error, 'event dead-lettered after max attempts', {
        eventType: row.event_type,
        id: row.id,
        attempts,
      });
      return;
    }

    // Exponential backoff with jitter on available_at.
    const delaySec = Math.min(3600, 2 ** attempts) + Math.floor(Math.random() * 5);
    await this.db.query(
      `UPDATE outbox_events
          SET status = 'failed', attempts = $2, last_error = $3,
              available_at = now() + make_interval(secs => $4)
        WHERE id = $1`,
      [row.id, attempts, message, delaySec],
      { name: 'outbox.retryLater', primary: true },
    );
    this.metrics.jobRuns.inc({ job: 'outbox', outcome: 'retry' });
    this.log.warn(
      { eventType: row.event_type, id: row.id, attempts, delaySec },
      'event delivery failed; will retry',
    );
  }

  /** Requeue failed rows whose backoff has elapsed (a light periodic nudge). */
  async requeueFailed(): Promise<number> {
    return this.db.execute_(
      `UPDATE outbox_events SET status = 'pending' WHERE status = 'failed' AND available_at <= now()`,
      [],
      { name: 'outbox.requeueFailed', primary: true },
    );
  }

  private toEvent(row: OutboxRow): DomainEvent {
    return {
      eventId: row.id as Uuid,
      type: row.event_type,
      version: row.event_version,
      occurredAt: new Date(row.occurred_at),
      tenantId: (row.tenant_id ?? undefined) as TenantId | undefined,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      correlationId: row.correlation_id ?? undefined,
      payload: row.payload,
    };
  }
}

interface OutboxRow {
  id: string;
  tenant_id: string | null;
  event_type: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: never;
  correlation_id: string | null;
  occurred_at: string;
  attempts: number;
}
