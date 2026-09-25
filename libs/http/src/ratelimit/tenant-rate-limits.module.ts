import { Global, Module } from '@nestjs/common';

import { TenantRateLimits } from './tenant-rate-limits';

/**
 * The per-operator rate-limit registry on its own, so a process without the
 * HTTP layer (the worker) can still load the tenancy module that registers
 * into it. One global instance: the guard and the tenancy module share it.
 */
@Global()
@Module({
  providers: [TenantRateLimits],
  exports: [TenantRateLimits],
})
export class TenantRateLimitsModule {}
