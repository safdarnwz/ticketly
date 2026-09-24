import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis, { type RedisOptions } from 'ioredis';
import { LRUCache } from 'lru-cache';

import { AppConfig } from '@config';
import { SingleFlight } from '@kernel';
import { Logger, Metrics, startTimer } from '@observability';

/**
 * ============================================================================
 *  Two-tier cache: L1 (in-process) + L2 (Redis)
 * ============================================================================
 *
 * THE LATENCY BUDGET, which is the whole reason this class exists:
 *
 *   L1 hit  : ~0.0001 ms   (a Map lookup — no syscall, no serialisation)
 *   L2 hit  : ~0.3-0.8 ms  (one network round trip + JSON parse)
 *   Postgres: ~2-40 ms     (round trip + planning + execution + I/O)
 *
 * A search endpoint that must answer in single-digit milliseconds cannot afford
 * to go to Postgres for master data (routes, stops, seat layouts, fare rules)
 * that changes a few times a week. It should not even go to Redis. So:
 *
 *   read → L1 → L2 → loader(Postgres) → backfill L2 → backfill L1
 *
 * FOUR PROBLEMS THIS SOLVES EXPLICITLY:
 *
 *  1. **Stampede.** `SingleFlight` collapses N concurrent misses on the same
 *     key into one loader call. Without it, a cache expiry during a festival
 *     rush is a self-inflicted DDoS on the database.
 *
 *  2. **L1 coherence across instances.** L1 lives in one Node process; a write
 *     on instance A must invalidate L1 on instances B and C. We publish
 *     invalidations on a Redis pub/sub channel and every instance drops the
 *     key locally. L1 TTLs are also kept short (default 5s) so the worst-case
 *     staleness is bounded even if pub/sub is unavailable.
 *
 *  3. **Stale-while-revalidate.** For expensive-but-tolerant values (occupancy
 *     counts on a search card), we serve the stale value instantly and refresh
 *     in the background. Latency stays flat under load.
 *
 *  4. **Redis is optional.** If L2 is disabled or Redis is unreachable, every
 *     method degrades to L1 + loader. A cache outage must never be an
 *     application outage.
 *
 * WHAT MUST NEVER BE CACHED: seat availability at booking time, payment state,
 * anything read to make a write decision. Those go to the primary, in the
 * transaction. Caching them is how a bus gets double-booked.
 */

export interface CacheOptions {
  /** Logical namespace — also the metrics label and the invalidation prefix. */
  namespace: string;
  /** Time-to-live in seconds for L2. */
  ttlSeconds: number;
  /** Override the L1 TTL (ms). Defaults to `CACHE_L1_TTL_MS`. */
  l1TtlMs?: number;
  /** Skip L1 entirely — for large values that would bloat process memory. */
  skipL1?: boolean;
  /**
   * Serve a stale value up to this many seconds past expiry while refreshing
   * in the background.
   */
  staleWhileRevalidateSeconds?: number;
}

interface Envelope<T> {
  v: T;
  /** Absolute expiry (epoch ms) — used for stale-while-revalidate. */
  e: number;
}

const INVALIDATION_CHANNEL = 'cache:invalidate';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private l1?: LRUCache<string, Envelope<unknown>>;
  private redis?: Redis;
  private subscriber?: Redis;
  private readonly flight = new SingleFlight<unknown>();
  private readonly log: Logger;
  private l2Healthy = false;

  constructor(
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('CacheService');
  }

  async onModuleInit(): Promise<void> {
    const { cache } = this.config;

    if (cache.l1Enabled) {
      this.l1 = new LRUCache<string, Envelope<unknown>>({
        max: cache.l1MaxItems,
        ttl: cache.l1TtlMs,
        // Reading a key should not extend its life; staleness must be bounded.
        updateAgeOnGet: false,
        allowStale: true,
      });
    }

    if (!cache.l2Enabled) {
      this.log.info('L2 cache disabled; running with L1 only');
      return;
    }

    const options: RedisOptions = {
      keyPrefix: `${cache.redisKeyPrefix}:`,
      connectTimeout: cache.redisConnectTimeoutMs,
      commandTimeout: cache.redisCommandTimeoutMs,
      maxRetriesPerRequest: cache.redisMaxRetriesPerRequest,
      enableOfflineQueue: false, // fail fast instead of queueing during an outage
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
    };

    this.redis = new Redis(cache.redisUrl, options);
    // The subscriber needs its own connection: a subscribed client cannot run
    // normal commands.
    this.subscriber = new Redis(cache.redisUrl, { ...options, keyPrefix: undefined });

    this.redis.on('error', (error) => {
      if (this.l2Healthy) this.log.error(error, 'redis error; degrading to L1 only');
      this.l2Healthy = false;
    });
    this.redis.on('ready', () => {
      this.l2Healthy = true;
      this.log.info('redis connected');
    });

    try {
      await this.redis.connect();
      await this.subscriber.connect();
      await this.subscriber.subscribe(INVALIDATION_CHANNEL);
      this.subscriber.on('message', (_channel, message) => this.onRemoteInvalidation(message));
      this.l2Healthy = true;
    } catch (error) {
      this.log.error(error, 'redis unavailable at startup; continuing with L1 only');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.redis?.quit(), this.subscriber?.quit()]);
  }

  /* ── core API ─────────────────────────────────────────────────────────*/

  /**
   * Read-through with stampede protection.
   * `loader` runs at most once per key per process at any instant.
   */
  async getOrLoad<T>(key: string, options: CacheOptions, loader: () => Promise<T>): Promise<T> {
    const fullKey = this.key(options.namespace, key);
    const now = Date.now();

    // ── L1 ──
    if (this.l1 && !options.skipL1) {
      const stop = startTimer();
      const hit = this.l1.get(fullKey) as Envelope<T> | undefined;
      this.metrics.cacheDuration.observe({ layer: 'l1', namespace: options.namespace }, stop());
      if (hit && hit.e > now) {
        this.metrics.cacheOps.inc({ layer: 'l1', namespace: options.namespace, result: 'hit' });
        return hit.v;
      }
      if (hit && options.staleWhileRevalidateSeconds && hit.e + options.staleWhileRevalidateSeconds * 1000 > now) {
        this.metrics.cacheOps.inc({ layer: 'l1', namespace: options.namespace, result: 'stale' });
        void this.refreshInBackground(fullKey, options, loader);
        return hit.v;
      }
      this.metrics.cacheOps.inc({ layer: 'l1', namespace: options.namespace, result: 'miss' });
    }

    // ── L2 + loader, collapsed per key ──
    return this.flight.do(fullKey, async () => {
      if (this.l2Available()) {
        const stop = startTimer();
        try {
          const raw = await this.redis!.get(fullKey);
          this.metrics.cacheDuration.observe({ layer: 'l2', namespace: options.namespace }, stop());
          if (raw !== null) {
            const envelope = JSON.parse(raw) as Envelope<T>;
            this.metrics.cacheOps.inc({ layer: 'l2', namespace: options.namespace, result: 'hit' });
            this.setL1(fullKey, envelope, options);
            return envelope.v;
          }
          this.metrics.cacheOps.inc({ layer: 'l2', namespace: options.namespace, result: 'miss' });
        } catch (error) {
          this.metrics.cacheOps.inc({ layer: 'l2', namespace: options.namespace, result: 'error' });
          this.log.warn({ err: (error as Error).message }, 'L2 read failed; falling through to loader');
        }
      }

      const value = await loader();
      await this.set(key, value, options);
      return value;
    }) as Promise<T>;
  }

  /** Plain read. Returns `undefined` on miss — no loader is invoked. */
  async get<T>(key: string, options: Pick<CacheOptions, 'namespace' | 'skipL1'>): Promise<T | undefined> {
    const fullKey = this.key(options.namespace, key);
    const now = Date.now();

    if (this.l1 && !options.skipL1) {
      const hit = this.l1.get(fullKey) as Envelope<T> | undefined;
      if (hit && hit.e > now) return hit.v;
    }
    if (!this.l2Available()) return undefined;

    try {
      const raw = await this.redis!.get(fullKey);
      if (raw === null) return undefined;
      return (JSON.parse(raw) as Envelope<T>).v;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T, options: CacheOptions): Promise<void> {
    const fullKey = this.key(options.namespace, key);
    const envelope: Envelope<T> = { v: value, e: Date.now() + options.ttlSeconds * 1000 };

    this.setL1(fullKey, envelope, options);

    if (this.l2Available()) {
      try {
        await this.redis!.set(fullKey, JSON.stringify(envelope), 'EX', options.ttlSeconds);
      } catch (error) {
        this.log.warn({ err: (error as Error).message }, 'L2 write failed');
      }
    }
  }

  /** Delete one key everywhere (all tiers, all instances). */
  async invalidate(key: string, namespace: string): Promise<void> {
    const fullKey = this.key(namespace, key);
    this.l1?.delete(fullKey);
    if (!this.l2Available()) return;
    try {
      await this.redis!.del(fullKey);
      await this.publishInvalidation(fullKey);
    } catch (error) {
      this.log.warn({ err: (error as Error).message }, 'invalidation failed');
    }
  }

  /**
   * Delete every key in a namespace, optionally under a prefix.
   *
   * Uses SCAN, never KEYS. `KEYS *` blocks the entire Redis event loop for the
   * duration of the scan — on a production instance that is a multi-second
   * outage for every service sharing that Redis.
   */
  async invalidatePrefix(namespace: string, prefix = ''): Promise<number> {
    const pattern = `${this.config.cache.redisKeyPrefix}:${namespace}:${prefix}*`;
    // L1 has no prefix index; clearing the namespace wholesale is cheap and
    // correct (entries repopulate on demand).
    this.clearL1Namespace(`${namespace}:${prefix}`);

    if (!this.l2Available()) return 0;
    let deleted = 0;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis!.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = next;
        if (keys.length > 0) {
          // ioredis prefixes keys automatically on write, so strip it for del.
          const unprefixed = keys.map((k) => k.slice(this.config.cache.redisKeyPrefix.length + 1));
          deleted += await this.redis!.del(...unprefixed);
        }
      } while (cursor !== '0');
      await this.publishInvalidation(`${namespace}:${prefix}*`);
    } catch (error) {
      this.log.warn({ err: (error as Error).message, pattern }, 'prefix invalidation failed');
    }
    return deleted;
  }

  /** Distributed lock — used by schedulers so only one instance runs a job. */
  async acquireLock(name: string, ttlSeconds: number): Promise<string | null> {
    if (!this.l2Available()) return null;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redis!.set(`lock:${name}`, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? token : null;
  }

  /** Release only if we still own it (compare-and-delete via Lua). */
  async releaseLock(name: string, token: string): Promise<void> {
    if (!this.l2Available()) return;
    await this.redis!.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      `${this.config.cache.redisKeyPrefix}:lock:${name}`,
      token,
    );
  }

  isHealthy(): boolean {
    return !this.config.cache.l2Enabled || this.l2Healthy;
  }

  /**
   * Narrow access to the shared Redis connection for components that need
   * primitives this class does not wrap (the Lua rate limiter, the scheduler's
   * leader election). Returns `undefined` whenever L2 is off or unhealthy, so
   * callers are forced to have a degraded path.
   */
  get connection(): Redis | undefined {
    return this.l2Available() ? this.redis : undefined;
  }

  /* ── internals ────────────────────────────────────────────────────────*/

  private key(namespace: string, key: string): string {
    return `${namespace}:${key}`;
  }

  private setL1<T>(fullKey: string, envelope: Envelope<T>, options: CacheOptions): void {
    if (!this.l1 || options.skipL1) return;
    this.l1.set(fullKey, envelope, {
      ttl: options.l1TtlMs ?? Math.min(this.config.cache.l1TtlMs, options.ttlSeconds * 1000),
    });
  }

  private clearL1Namespace(prefix: string): void {
    if (!this.l1) return;
    for (const key of this.l1.keys()) {
      if (key.startsWith(prefix)) this.l1.delete(key);
    }
  }

  private l2Available(): boolean {
    return this.config.cache.l2Enabled && this.l2Healthy && this.redis !== undefined;
  }

  private async publishInvalidation(pattern: string): Promise<void> {
    try {
      await this.redis?.publish(INVALIDATION_CHANNEL, JSON.stringify({ pattern, from: process.pid }));
    } catch {
      /* best effort — L1 TTL bounds the staleness anyway */
    }
  }

  private onRemoteInvalidation(message: string): void {
    try {
      const { pattern, from } = JSON.parse(message) as { pattern: string; from: number };
      if (from === process.pid) return;
      if (pattern.endsWith('*')) this.clearL1Namespace(pattern.slice(0, -1));
      else this.l1?.delete(pattern);
    } catch {
      /* ignore malformed messages */
    }
  }

  private async refreshInBackground<T>(
    fullKey: string,
    options: CacheOptions,
    loader: () => Promise<T>,
  ): Promise<void> {
    void this.flight.do(`refresh:${fullKey}`, async () => {
      try {
        const value = await loader();
        await this.set(fullKey.slice(options.namespace.length + 1), value, options);
      } catch (error) {
        this.log.warn({ err: (error as Error).message, key: fullKey }, 'background refresh failed');
      }
      return undefined;
    });
  }
}
