import { Injectable, type OnModuleInit } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { TenantRateLimits } from '@http';
import { NotFoundError } from '@kernel';

import { TenantRepository } from '../../infrastructure/persistence/tenant.repository';

/**
 * Per-operator API rate limits (#62). The rate-limit guard asks for the limit
 * on every request, so it is cached like the rest of the tenant config and
 * dropped when a platform admin changes it.
 */
@Injectable()
export class TenantRateLimitService implements OnModuleInit {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly cache: CacheService,
    private readonly limits: TenantRateLimits,
  ) {}

  onModuleInit(): void {
    this.limits.register((tenantId) => this.limitFor(tenantId));
  }

  async limitFor(tenantId: string): Promise<number | null> {
    return this.cache.getOrLoad<number | null>(
      `ratelimit:${tenantId}`,
      { namespace: CacheNamespace.TENANT, ttlSeconds: CacheTtl.TENANT_CONFIG },
      () => this.tenants.apiRateLimit(tenantId),
    );
  }

  async set(tenantId: string, limit: number | null): Promise<{ limit: number | null }> {
    if (!(await this.tenants.setApiRateLimit(tenantId, limit)))
      throw new NotFoundError('Operator', tenantId);
    await this.cache.invalidate(`ratelimit:${tenantId}`, CacheNamespace.TENANT);
    return { limit };
  }
}
