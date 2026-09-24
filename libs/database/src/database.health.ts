import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

import { DatabaseService } from './database.service';

export interface DatabaseHealth {
  status: 'up' | 'degraded' | 'down';
  latencyMs: number;
  pool: { total: number; idle: number; waiting: number; max: number };
  replicas: { name: string; total: number; idle: number; waiting: number }[];
  error?: string;
}

/**
 * Health probe.
 *
 * READINESS vs LIVENESS — the distinction that stops cascading outages:
 *  - *liveness* must NOT touch the database. If Postgres is briefly down, we do
 *    not want Kubernetes/systemd restarting every API process; that makes the
 *    incident worse.
 *  - *readiness* checks the database, so an instance that cannot serve is
 *    removed from the load balancer while staying alive to recover.
 *
 * `degraded` (pool nearly exhausted) is reported separately from `down` so
 * dashboards can alert before customers see errors.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfig,
  ) {}

  async check(): Promise<DatabaseHealth> {
    const started = process.hrtime.bigint();
    const pool = this.db.primary.pool;
    const snapshot = {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: this.config.db.poolMax,
    };
    const replicas = this.db.replicas.map((r) => ({
      name: r.name,
      total: r.pool.totalCount,
      idle: r.pool.idleCount,
      waiting: r.pool.waitingCount,
    }));

    try {
      await this.db.query('SELECT 1 AS ok', [], { name: 'health.db', primary: true });
      const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
      const saturated = snapshot.waiting > 0 && snapshot.idle === 0;
      return {
        status: saturated ? 'degraded' : 'up',
        latencyMs: Math.round(latencyMs * 100) / 100,
        pool: snapshot,
        replicas,
      };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
        pool: snapshot,
        replicas,
        error: (error as Error).message,
      };
    }
  }
}
