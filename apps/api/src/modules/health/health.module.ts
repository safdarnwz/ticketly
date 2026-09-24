import { Module, type OnApplicationBootstrap } from '@nestjs/common';

import { HealthController } from './health.controller';
import { ReadinessState } from './readiness.state';

@Module({
  controllers: [HealthController],
  providers: [ReadinessState],
  exports: [ReadinessState],
})
export class HealthModule implements OnApplicationBootstrap {
  constructor(private readonly readiness: ReadinessState) {}

  onApplicationBootstrap(): void {
    this.readiness.markStarted();
  }
}
