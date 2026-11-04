import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_CONFIG, AppConfig } from '../config/configuration';

/** SLA dashboard for the 5-minute promise: how many made it, how fast, and which step is slow. */
@Injectable()
export class MetricsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  async instantDisbursal(from: Date, to: Date) {
    const [summary] = await this.ds.query(
      `SELECT count(*)::int AS "applications",
              count(*) FILTER (WHERE status = 'DISBURSED')::int AS "disbursed",
              count(*) FILTER (WHERE "withinTarget")::int AS "withinTarget",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY "totalElapsedMs") FILTER (WHERE status = 'DISBURSED') AS "p50Ms",
              percentile_cont(0.9) WITHIN GROUP (ORDER BY "totalElapsedMs") FILTER (WHERE status = 'DISBURSED') AS "p90Ms",
              percentile_cont(0.95) WITHIN GROUP (ORDER BY "totalElapsedMs") FILTER (WHERE status = 'DISBURSED') AS "p95Ms"
         FROM loan_applications WHERE "createdAt" BETWEEN $1 AND $2`,
      [from, to],
    );
    const steps = await this.ds.query(
      `SELECT step,
              count(*)::int AS "count",
              count(*) FILTER (WHERE outcome = 'FAILED')::int AS "failed",
              count(*) FILTER (WHERE outcome = 'REFERRED')::int AS "referred",
              count(*) FILTER (WHERE "elapsedMs" > "targetCompleteByMs")::int AS "lateVsTarget",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS "p50DurationMs",
              percentile_cont(0.9) WITHIN GROUP (ORDER BY "durationMs") AS "p90DurationMs"
         FROM journey_events WHERE "createdAt" BETWEEN $1 AND $2 GROUP BY step`,
      [from, to],
    );
    const funnel = await this.ds.query(
      `SELECT status, count(*)::int AS "count" FROM loan_applications WHERE "createdAt" BETWEEN $1 AND $2 GROUP BY status ORDER BY 2 DESC`,
      [from, to],
    );
    const rails = await this.ds.query(
      `SELECT rail, status, count(*)::int AS "count" FROM disbursements WHERE "createdAt" BETWEEN $1 AND $2 GROUP BY rail, status`,
      [from, to],
    );
    const num = (v: unknown) => (v == null ? null : Math.round(Number(v)));
    return {
      targetSeconds: this.cfg.journeyTargetSeconds,
      from, to,
      applications: summary.applications,
      disbursed: summary.disbursed,
      withinTarget: summary.withinTarget,
      withinTargetPct: summary.disbursed ? Math.round((summary.withinTarget / summary.disbursed) * 1000) / 10 : null,
      p50Ms: num(summary.p50Ms), p90Ms: num(summary.p90Ms), p95Ms: num(summary.p95Ms),
      steps: steps.map((s: Record<string, unknown>) => ({ ...s, p50DurationMs: num(s.p50DurationMs), p90DurationMs: num(s.p90DurationMs) })),
      funnel,
      rails,
    };
  }
}
