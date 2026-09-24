import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '@config';
import { ObservabilityModule } from '@observability';

import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [ConfigModule, ObservabilityModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
