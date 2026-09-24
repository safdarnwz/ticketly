import { Injectable } from '@nestjs/common';
import { LRUCache } from 'lru-cache';

import { AppConfig } from '@config';
import { CacheService } from '@cache';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
}

/**
 * ============================================================================
 *  Sliding-window rate limiter
 * ============================================================================
 *
 * ALGORITHM: sliding window counter, not a fixed window.
 * A fixed window lets a client send `limit` requests at 12:00:59 and another
 * `limit` at 12:01:00 — 2x the intended rate at the boundary, which is exactly
 * when a bot will hit you. The sliding counter weights the previous window by
 * how much of it is still in view:
 *
 *   estimate = previousCount * (1 - elapsedFraction) + currentCount
 *
 * It costs two integers per key instead of a sorted set of timestamps, which
 * matters at 50k req/s.
 *
 * DISTRIBUTED vs LOCAL: with Redis the counter is shared across all instances
 * (the whole script is one atomic Lua call — no read-modify-write race). Without
 * Redis we fall back to a per-process limiter, which under N instances permits
 * roughly N times the configured rate. That is a deliberate, documented
 * trade-off: degrade the limit, never the availability.
 */
const SLIDING_WINDOW_LUA = `
local currentKey  = KEYS[1]
local previousKey = KEYS[2]
local limit       = tonumber(ARGV[1])
local windowMs    = tonumber(ARGV[2])
local nowMs       = tonumber(ARGV[3])
local cost        = tonumber(ARGV[4])

local elapsed  = nowMs % windowMs
local fraction = 1 - (elapsed / windowMs)

local previous = tonumber(redis.call('GET', previousKey) or '0')
local current  = tonumber(redis.call('GET', currentKey)  or '0')

local estimate = math.floor(previous * fraction + current)

if estimate + cost > limit then
  return { 0, limit, 0, math.ceil((windowMs - elapsed) / 1000) }
end

current = redis.call('INCRBY', currentKey, cost)
if current == cost then
  redis.call('PEXPIRE', currentKey, windowMs * 2)
end

local remaining = math.max(0, limit - (math.floor(previous * fraction) + current))
return { 1, limit, remaining, math.ceil((windowMs - elapsed) / 1000) }
`;

@Injectable()
export class RateLimiter {
  /** Fallback store when Redis is unavailable. */
  private readonly local = new LRUCache<string, { count: number; windowStart: number }>({
    max: 100_000,
    ttl: 300_000,
  });

  constructor(
    private readonly cache: CacheService,
    private readonly config: AppConfig,
  ) {}

  async consume(key: string, limit: number, windowMs: number, cost = 1): Promise<RateLimitResult> {
    if (!this.config.rateLimit.enabled) {
      return { allowed: true, limit, remaining: limit, resetAfterSeconds: 0 };
    }

    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const currentKey = `rl:${key}:${windowIndex}`;
    const previousKey = `rl:${key}:${windowIndex - 1}`;

    const redis = this.redis();
    if (redis) {
      try {
        const [allowed, resolvedLimit, remaining, reset] = (await redis.eval(
          SLIDING_WINDOW_LUA,
          2,
          `${this.config.cache.redisKeyPrefix}:${currentKey}`,
          `${this.config.cache.redisKeyPrefix}:${previousKey}`,
          String(limit),
          String(windowMs),
          String(now),
          String(cost),
        )) as [number, number, number, number];
        return {
          allowed: allowed === 1,
          limit: resolvedLimit,
          remaining,
          resetAfterSeconds: reset,
        };
      } catch {
        // fall through to the local limiter
      }
    }

    return this.consumeLocal(key, limit, windowMs, cost, now);
  }

  private consumeLocal(
    key: string,
    limit: number,
    windowMs: number,
    cost: number,
    now: number,
  ): RateLimitResult {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const entry = this.local.get(key);
    const bucket =
      entry && entry.windowStart === windowStart ? entry : { count: 0, windowStart };

    if (bucket.count + cost > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000),
      };
    }

    bucket.count += cost;
    this.local.set(key, bucket, { ttl: windowMs * 2 });
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAfterSeconds: Math.ceil((windowStart + windowMs - now) / 1000),
    };
  }

  /** CacheService owns the connection; `undefined` means "use the local path". */
  private redis(): ReturnType<CacheService['connection']> | undefined {
    return this.cache.connection;
  }
}
