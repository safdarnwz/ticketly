import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
  type Metric,
} from 'prom-client';

/**
 * ============================================================================
 *  Metrics
 * ============================================================================
 *
 * CARDINALITY IS THE ONLY RULE THAT MATTERS. Every distinct label-value
 * combination is a separate time series. Never label with:
 *   ✗ tenantId (thousands)   ✗ bookingId / tripId (unbounded)
 *   ✗ raw URL path with ids  ✗ user agent
 * Always label with:
 *   ✓ route *template* (`/trips/:id`)  ✓ status class  ✓ operation name
 *
 * Per-tenant numbers belong in the reporting store (Part 10), not in Prometheus.
 *
 * Histogram buckets are chosen for THIS system's SLOs: search p99 < 120ms,
 * booking-confirm p99 < 400ms. Default buckets (0.005 … 10s) would put every
 * search into one bucket and tell us nothing.
 */
export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2, 5];
export const DB_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

@Injectable()
export class Metrics {
  readonly registry = new Registry();

  // ── HTTP ────────────────────────────────────────────────────────────────
  readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  readonly httpDuration: Histogram<'method' | 'route' | 'status'>;
  readonly httpInFlight: Gauge<'method'>;

  // ── Database ────────────────────────────────────────────────────────────
  readonly dbQueries: Counter<'operation' | 'target' | 'outcome'>;
  readonly dbDuration: Histogram<'operation' | 'target'>;
  readonly dbPoolTotal: Gauge<'pool'>;
  readonly dbPoolIdle: Gauge<'pool'>;
  readonly dbPoolWaiting: Gauge<'pool'>;
  readonly dbTransactionRetries: Counter<'reason'>;

  // ── Cache ───────────────────────────────────────────────────────────────
  readonly cacheOps: Counter<'layer' | 'namespace' | 'result'>;
  readonly cacheDuration: Histogram<'layer' | 'namespace'>;

  // ── Domain (populated from Part 5 onwards) ──────────────────────────────
  readonly seatHolds: Counter<'outcome'>;
  readonly bookings: Counter<'outcome' | 'channel'>;
  readonly searchRequests: Counter<'cached'>;
  readonly outboxLag: Gauge<'status'>;
  readonly jobRuns: Counter<'job' | 'outcome'>;
  readonly jobDuration: Histogram<'job'>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'gds_' });

    this.httpRequests = this.counter('gds_http_requests_total', 'HTTP requests', [
      'method',
      'route',
      'status',
    ]);
    this.httpDuration = this.histogram(
      'gds_http_request_duration_seconds',
      'HTTP request duration',
      ['method', 'route', 'status'],
      HTTP_DURATION_BUCKETS,
    );
    this.httpInFlight = this.gauge('gds_http_in_flight_requests', 'In-flight HTTP requests', [
      'method',
    ]);

    this.dbQueries = this.counter('gds_db_queries_total', 'Database queries', [
      'operation',
      'target',
      'outcome',
    ]);
    this.dbDuration = this.histogram(
      'gds_db_query_duration_seconds',
      'Database query duration',
      ['operation', 'target'],
      DB_DURATION_BUCKETS,
    );
    this.dbPoolTotal = this.gauge('gds_db_pool_connections_total', 'Pooled connections', ['pool']);
    this.dbPoolIdle = this.gauge('gds_db_pool_connections_idle', 'Idle pooled connections', [
      'pool',
    ]);
    this.dbPoolWaiting = this.gauge(
      'gds_db_pool_waiting_requests',
      'Requests waiting for a connection',
      ['pool'],
    );
    this.dbTransactionRetries = this.counter(
      'gds_db_transaction_retries_total',
      'Transaction retries',
      ['reason'],
    );

    this.cacheOps = this.counter('gds_cache_operations_total', 'Cache operations', [
      'layer',
      'namespace',
      'result',
    ]);
    this.cacheDuration = this.histogram(
      'gds_cache_operation_duration_seconds',
      'Cache operation duration',
      ['layer', 'namespace'],
      [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1],
    );

    this.seatHolds = this.counter('gds_seat_holds_total', 'Seat hold attempts', ['outcome']);
    this.bookings = this.counter('gds_bookings_total', 'Booking outcomes', ['outcome', 'channel']);
    this.searchRequests = this.counter('gds_search_requests_total', 'Trip search requests', [
      'cached',
    ]);
    this.outboxLag = this.gauge('gds_outbox_pending_events', 'Outbox events by status', ['status']);
    this.jobRuns = this.counter('gds_job_runs_total', 'Background job runs', ['job', 'outcome']);
    this.jobDuration = this.histogram(
      'gds_job_duration_seconds',
      'Background job duration',
      ['job'],
      [0.01, 0.1, 0.5, 1, 5, 15, 60, 300],
    );
  }

  async scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** Register an ad-hoc metric from a feature module. */
  register(metric: Metric): void {
    this.registry.registerMetric(metric);
  }

  private counter<T extends string>(name: string, help: string, labelNames: T[]): Counter<T> {
    const metric = new Counter({ name, help, labelNames });
    this.registry.registerMetric(metric);
    return metric;
  }

  private gauge<T extends string>(name: string, help: string, labelNames: T[]): Gauge<T> {
    const metric = new Gauge({ name, help, labelNames });
    this.registry.registerMetric(metric);
    return metric;
  }

  private histogram<T extends string>(
    name: string,
    help: string,
    labelNames: T[],
    buckets: number[],
  ): Histogram<T> {
    const metric = new Histogram({ name, help, labelNames, buckets });
    this.registry.registerMetric(metric);
    return metric;
  }
}

/** Start a timer that returns elapsed seconds — matches histogram units. */
export function startTimer(): () => number {
  const start = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - start) / 1e9;
}
