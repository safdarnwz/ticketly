import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { ObservabilityModule } from '@observability';

import { DatabaseService } from './database.service';
import { DatabaseHealthIndicator } from './database.health';
import { UnitOfWork } from './unit-of-work';

@Global()
@Module({
  imports: [ConfigModule, ObservabilityModule],
  providers: [DatabaseService, UnitOfWork, DatabaseHealthIndicator],
  exports: [DatabaseService, UnitOfWork, DatabaseHealthIndicator],
})
export class DatabaseModule {}
