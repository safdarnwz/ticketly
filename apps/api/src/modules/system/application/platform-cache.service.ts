import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService } from '@cache';

/**
 * What a platform admin may flush (#116). Idempotency keys and rate-limit
 * counters are not caches: dropping them would let a retried payment run
 * twice or reset every client's limit, so they are never cleared here.
 */
export const CLEARABLE_CACHE_NAMESPACES = Object.values(CacheNamespace).filter(
  (ns) => ns !== CacheNamespace.IDEMPOTENCY && ns !== CacheNamespace.RATE_LIMIT,
);

@Injectable()
export class PlatformCacheService {
  constructor(private readonly cache: CacheService) {}

  /** Clear the given namespaces (all clearable ones by default), on every API instance. */
  async clear(namespaces: readonly string[] = CLEARABLE_CACHE_NAMESPACES): Promise<{
    cleared: Record<string, number>;
  }> {
    const cleared: Record<string, number> = {};
    for (const ns of namespaces) cleared[ns] = await this.cache.invalidatePrefix(ns);
    return { cleared };
  }
}
