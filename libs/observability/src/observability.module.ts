import { Global, Module } from '@nestjs/common';

import { AppConfig, ConfigModule } from '@config';

import { createRootLogger, Logger, ROOT_LOGGER } from './logger';
import { Metrics } from './metrics';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: ROOT_LOGGER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => createRootLogger(config),
    },
    {
      provide: Logger,
      inject: [ROOT_LOGGER],
      useFactory: (root: ReturnType<typeof createRootLogger>) => new Logger(root),
    },
    Metrics,
  ],
  exports: [ROOT_LOGGER, Logger, Metrics],
})
export class ObservabilityModule {}
