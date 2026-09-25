import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { CacheModule } from '@cache';

import { PlatformCacheService } from './application/platform-cache.service';
import { ReadinessState } from './application/readiness.state';
import { PlatformCacheController } from './presentation/platform-cache.controller';
import { HealthController } from './presentation/health.controller';
import { MetricsController } from './presentation/metrics.controller';

/** Operational endpoints: liveness/readiness probes, Prometheus metrics, cache flush. */
@Module({
  imports: [CacheModule],
  controllers: [HealthController, MetricsController, PlatformCacheController],
  providers: [ReadinessState, PlatformCacheService],
  exports: [ReadinessState],
})
export class SystemModule implements OnApplicationBootstrap {
  constructor(private readonly readiness: ReadinessState) {}

  onApplicationBootstrap(): void {
    this.readiness.markStarted();
  }
}
