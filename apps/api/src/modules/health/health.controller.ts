import { Controller, Get, HttpCode, ServiceUnavailableException, Version, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { CacheService } from '@cache';
import { AppConfig } from '@config';
import { DatabaseHealthIndicator } from '@database';
import { Public } from '@http';

import { ReadinessState } from './readiness.state';

/**
 * Probe endpoints. Excluded from the API prefix and from OpenAPI: they are
 * infrastructure contracts, not product surface.
 *
 * PROBE SEMANTICS
 *  GET /health/live    → 200 unless the process is broken. NEVER touches the DB.
 *  GET /health/ready   → 200 only when we can actually serve. Checks the DB.
 *  GET /health/startup → 200 once boot finished. Long initial grace period.
 *  GET /health         → verbose, for humans and dashboards.
 *
 * The distinction is what prevents a brief database blip from triggering a
 * restart storm across every instance simultaneously.
 */
@ApiExcludeController()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly database: DatabaseHealthIndicator,
    private readonly cache: CacheService,
    private readonly readiness: ReadinessState,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('live')
  @HttpCode(200)
  @Version(VERSION_NEUTRAL)
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: this.readiness.uptimeSeconds };
  }

  @Public()
  @Get('startup')
  @Version(VERSION_NEUTRAL)
  startup(): { status: string } {
    if (!this.readiness.isStarted) throw new ServiceUnavailableException('starting');
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @Version(VERSION_NEUTRAL)
  async ready(): Promise<{ status: string }> {
    if (!this.readiness.isReady) {
      throw new ServiceUnavailableException(this.readiness.isDraining ? 'draining' : 'not-ready');
    }
    const db = await this.database.check();
    if (db.status === 'down') throw new ServiceUnavailableException('database-unavailable');
    return { status: 'ok' };
  }

  @Public()
  @Get()
  @Version(VERSION_NEUTRAL)
  async detail(): Promise<Record<string, unknown>> {
    const db = await this.database.check();
    const memory = process.memoryUsage();

    return {
      status: db.status === 'down' ? 'down' : this.readiness.isReady ? 'ok' : 'degraded',
      service: this.config.app.name,
      version: this.config.app.version,
      instance: this.config.app.instanceId,
      environment: this.config.env_,
      uptimeSeconds: this.readiness.uptimeSeconds,
      ready: this.readiness.isReady,
      draining: this.readiness.isDraining,
      checks: {
        database: db,
        cache: {
          status: this.cache.isHealthy() ? 'up' : 'degraded',
          l2Enabled: this.config.cache.l2Enabled,
        },
      },
      runtime: {
        node: process.version,
        pid: process.pid,
        rssMb: Math.round(memory.rss / 1_048_576),
        heapUsedMb: Math.round(memory.heapUsed / 1_048_576),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
