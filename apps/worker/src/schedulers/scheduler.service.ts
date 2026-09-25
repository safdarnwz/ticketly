import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { CacheService } from '@cache';
import { AppConfig } from '@config';
import { DatabaseService } from '@database';
import { Logger, Metrics } from '@observability';

import { DataRetentionService } from '@api/modules/platform-settings';
import { WebhookDeliveryService } from '@api/modules/webhooks';
import { PayoutScheduler } from './payout.scheduler';
import { TripReminderScheduler } from './trip-reminder.scheduler';
import { ConnectionMonitorScheduler } from './connection-monitor.scheduler';
import { VehicleVerificationService } from '@api/modules/fleet/application/services/vehicle-verification.service';
import { RefundService } from '@api/modules/refunds/application/services/refund.service';
import { SeatQuotaService } from '@api/modules/quotas/application/seat-quota.service';
import { PaymentService } from '@api/modules/payment/application/services/payment.service';

/**
 * ============================================================================
 *  Schedulers — periodic maintenance jobs
 * ============================================================================
 *
 * All the "run every N seconds/daily" work lives here. Each job is guarded by a
 * **distributed lock** (Redis SET NX) so that with multiple worker replicas,
 * exactly one runs a given job at a time — a seat-hold sweep or partition
 * creation must not run N times concurrently.
 *
 * The jobs:
 *  - **seat-hold sweeper** (every ~30s): expire holds past their TTL and free
 *    the seats, so an abandoned checkout doesn't lock inventory forever. This is
 *    the counterpart to Part 7's hold, and it's why the availability check can
 *    treat only *unexpired* holds as blocking.
 *  - **partition maintenance** (hourly): create next-period partitions for
 *    outbox_events, audit_log and gps_pings before they're needed.
 *  - **idempotency purge** (hourly): delete expired idempotency keys.
 *  - **outbox requeue** (every ~minute): move backed-off failed events back to
 *    pending.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
    private readonly webhookDelivery: WebhookDeliveryService,
    private readonly payout: PayoutScheduler,
    private readonly tripReminders: TripReminderScheduler,
    private readonly connectionMonitor: ConnectionMonitorScheduler,
    private readonly vehicleVerification: VehicleVerificationService,
    private readonly refunds: RefundService,
    private readonly quotas: SeatQuotaService,
    private readonly payments: PaymentService,
    private readonly retention: DataRetentionService,
  ) {
    this.log = logger.forContext('Scheduler');
  }

  onModuleInit(): void {
    if (!this.config.worker.enabled) return;
    this.every(30_000, 'seat-hold-sweep', () => this.sweepExpiredHolds());
    this.every(60_000, 'outbox-requeue', () => this.requeueFailedOutbox());
    this.every(3_600_000, 'partition-maintenance', () => this.maintainPartitions());
    this.every(3_600_000, 'idempotency-purge', () => this.purgeIdempotency());
    this.every(6 * 3_600_000, 'data-retention', () => this.applyRetention());
    this.every(300_000, 'reporting-refresh', () => this.refreshReports());
    this.every(60_000, 'webhook-retry', () => this.retryWebhooks());
    this.every(600_000, 'trip-reminders', () => this.tripReminders.run().then(() => undefined));
    this.every(300_000, 'connection-risk-monitor', () =>
      this.connectionMonitor.run().then(() => undefined),
    );
    // Checked hourly rather than once at boot: a worker that restarts at any
    // time of day must still catch Monday/Thursday whenever it next runs,
    // and payoutWindowFor + SettlementService.generate are both idempotent
    // per (tenant, period), so checking more than once on a payout day is
    // harmless — it just confirms the payout already ran and does nothing.
    this.every(3_600_000, 'weekly-payout', () => this.runPayoutIfDue());
    // A bus whose verified insurance/permit/fitness/PUC/RC/road-tax has lapsed
    // is suspended and pulled off future trips. Hourly so a document expiring
    // at midnight is caught early in the day; idempotent per bus.
    // Gateway refunds recorded but never confirmed as sent (crash / PSP
    // timeout) are re-sent with the SAME idempotency key — never doubled.
    // Unsold agent/branch quota seats return to general sale at their release time.
    this.every(60_000, 'seat-quota-release', async () => {
      const n = await this.quotas.releaseDue();
      if (n > 0) this.log.info({ released: n }, 'quota seats returned to general sale');
    });
    this.every(120_000, 'refund-dispatch-sweep', async () => {
      const n = await this.refunds.dispatchPending();
      if (n > 0) this.log.warn({ resent: n }, 'refunds re-dispatched to the gateway');
      const d = await this.payments.retryDuplicateRefunds();
      if (d > 0) this.log.warn({ resent: d }, 'duplicate-payment refunds re-sent');
    });
    this.every(3_600_000, 'vehicle-document-expiry', async () => {
      const n = await this.vehicleVerification.suspendExpired();
      if (n > 0) this.log.warn({ suspended: n }, 'buses suspended for expired documents');
    });
    this.log.info('schedulers started');
  }

  onModuleDestroy(): void {
    this.timers.forEach(clearInterval);
  }

  /**
   * Register a job on an interval, guarded by a distributed lock. Also fires
   * once immediately on registration (not just after the first interval
   * elapses) — every job above is explicitly documented as idempotent/safe to
   * run more than once, and without this a freshly-booted worker leaves
   * things like the reporting materialized views empty (queries against them
   * fail with "has not been populated") for a full interval — up to 5
   * minutes for reporting-refresh, or an hour for the hourly jobs — after
   * every restart, not just the very first boot.
   */
  private every(ms: number, name: string, job: () => Promise<void>): void {
    void this.runLocked(name, ms, job);
    const timer = setInterval(() => void this.runLocked(name, ms, job), ms);
    timer.unref();
    this.timers.push(timer);
  }

  private async runLocked(name: string, ms: number, job: () => Promise<void>): Promise<void> {
    // Lock TTL slightly under the interval so a crashed holder's lock frees.
    const token = await this.cache.acquireLock(`sched:${name}`, Math.ceil(ms / 1000) - 1);
    if (!token && this.config.cache.l2Enabled) return; // another replica has it
    const stop = Date.now();
    try {
      await job();
      this.metrics.jobRuns.inc({ job: name, outcome: 'ok' });
    } catch (error) {
      this.metrics.jobRuns.inc({ job: name, outcome: 'error' });
      this.log.error(error, `scheduled job '${name}' failed`);
    } finally {
      this.metrics.jobDuration.observe({ job: name }, (Date.now() - stop) / 1000);
      if (token) await this.cache.releaseLock(`sched:${name}`, token);
    }
  }

  /**
   * Expire held bookings past their hold TTL and free the seats. Done in one
   * statement set per batch, inside a transaction so the booking status and the
   * inventory release commit together.
   */
  async sweepExpiredHolds(): Promise<void> {
    const expired = await this.db.query<{ id: string; trip_id: string; tenant_id: string }>(
      `SELECT id, trip_id, tenant_id FROM bookings
        WHERE status = 'held' AND hold_expires_at < now()
        LIMIT 500`,
      [],
      { name: 'sweep.findExpired', primary: true },
    );
    if (expired.length === 0) return;

    for (const booking of expired) {
      await this.db.withClient(true, {}, async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(`SELECT set_config('app.bypass_rls','on',true)`);
          // Release each seat's held legs from occupied? Holds never wrote
          // occupied_legs (only confirm does), so we just mark the booking
          // expired; the seats were never confirmed-occupied.
          //
          // CRITICAL: the WHERE clause re-checks status = 'held' at UPDATE
          // time, not just at the SELECT above — if a payment raced this
          // sweep and confirmed the booking in the gap between the SELECT
          // and this UPDATE, the row is no longer 'held' and this correctly
          // becomes a no-op (0 rows affected) instead of silently flipping
          // an already-CONFIRMED, already-PAID booking back to 'expired'.
          await client.query(
            `UPDATE bookings SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'held'`,
            [booking.id],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          this.log.error(error, 'failed to expire hold', { bookingId: booking.id });
        }
      });
    }
    this.log.info({ count: expired.length }, 'expired stale holds');
  }

  private async requeueFailedOutbox(): Promise<void> {
    const n = await this.db.execute_(
      `UPDATE outbox_events SET status = 'pending' WHERE status = 'failed' AND available_at <= now()`,
      [],
      { name: 'sched.requeueOutbox', primary: true },
    );
    if (n > 0) this.log.debug({ n }, 'requeued failed outbox events');
  }

  private async maintainPartitions(): Promise<void> {
    await this.db.query('SELECT ensure_outbox_partitions(3)', [], {
      name: 'sched.outboxParts',
      primary: true,
    });
    await this.db.query('SELECT ensure_audit_partitions(3)', [], {
      name: 'sched.auditParts',
      primary: true,
    });
    await this.db.query('SELECT ensure_gps_partitions(3)', [], {
      name: 'sched.gpsParts',
      primary: true,
    });
  }

  private async refreshReports(): Promise<void> {
    // CONCURRENTLY refresh keeps the dashboards current without blocking reads.
    await this.db.query('SELECT refresh_reporting_views()', [], {
      name: 'sched.refreshReports',
      primary: true,
    });
  }

  private async purgeIdempotency(): Promise<void> {
    const n = await this.db.execute_(`SELECT purge_expired_idempotency_keys(5000)`, [], {
      name: 'sched.purgeIdem',
      primary: true,
    });
    if (n > 0) this.log.debug({ n }, 'purged idempotency keys');
  }

  /** Delete operational logs older than the platform's data retention policy (#75). */
  private async applyRetention(): Promise<void> {
    const deleted = await this.retention.run();
    if (Object.keys(deleted).length > 0) this.log.info({ deleted }, 'data retention purge');
  }

  /** Re-attempt webhook deliveries that failed and are due for their next backoff try. */
  private async retryWebhooks(): Promise<void> {
    const n = await this.webhookDelivery.retryDue();
    if (n > 0) this.log.debug({ n }, 'retried pending webhook deliveries');
  }

  /** Mon/Tue/Wed bookings → payout Thursday; Thu-Sun bookings → payout Monday. No-op on every other day. */
  private async runPayoutIfDue(): Promise<void> {
    const result = await this.payout.runIfDue();
    if (result.ran) this.log.info(result, 'weekly payout run complete');
  }
}
