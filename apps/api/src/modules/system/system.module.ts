import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { ReadinessState } from './application/readiness.state';
import { HealthController } from './presentation/health.controller';
import { MetricsController } from './presentation/metrics.controller';

/** Operational endpoints: liveness/readiness probes and Prometheus metrics. */
@Module({
  controllers: [HealthController, MetricsController],
  providers: [ReadinessState],
  exports: [ReadinessState],
})
export class SystemModule implements OnApplicationBootstrap {
  constructor(private readonly readiness: ReadinessState) {}

  onApplicationBootstrap(): void {
    this.readiness.markStarted();
  }
}
