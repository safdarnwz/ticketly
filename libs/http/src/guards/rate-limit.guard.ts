import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppConfig } from '@config';
import { getContext, RateLimitedError } from '@kernel';

import { RATE_LIMIT_KEY, type RateLimitSpec } from '../decorators/rate-limit.decorator';
import { RateLimiter } from '../ratelimit/rate-limiter';

/**
 * Applies rate limits in layers, cheapest identity first:
 *
 *   1. per authenticated tenant  — the real unit of fair use in a SaaS
 *   2. per IP                    — catches unauthenticated abuse
 *   3. per route (optional)      — protects specific expensive endpoints
 *
 * All three must pass. Limits are advertised on every response
 * (`RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`) so a
 * well-behaved OTA integration can pace itself instead of discovering the
 * limit by being blocked.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http' || !this.config.rateLimit.enabled) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const ctx = getContext();

    const route = request.routeOptions?.url ?? request.url;
    const spec = this.reflector.getAllAndOverride<RateLimitSpec | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const checks: { key: string; limit: number; windowMs: number }[] = [];
    const { rateLimit } = this.config;

    if (ctx?.tenantId) {
      checks.push({
        key: `t:${ctx.tenantId}`,
        limit: rateLimit.maxPerTenant,
        windowMs: rateLimit.windowMs,
      });
    }
    if (ctx?.ip) {
      checks.push({ key: `ip:${ctx.ip}`, limit: rateLimit.maxPerIp, windowMs: rateLimit.windowMs });
    }
    if (spec) {
      const scope = spec.scope === 'tenant' ? (ctx?.tenantId ?? 'anon') : (ctx?.ip ?? 'unknown');
      checks.push({ key: `r:${route}:${scope}`, limit: spec.limit, windowMs: spec.windowMs });
    }

    for (const check of checks) {
      const result = await this.limiter.consume(check.key, check.limit, check.windowMs);
      void reply.header('RateLimit-Limit', String(result.limit));
      void reply.header('RateLimit-Remaining', String(result.remaining));
      void reply.header('RateLimit-Reset', String(result.resetAfterSeconds));
      if (!result.allowed) throw new RateLimitedError(result.resetAfterSeconds);
    }

    return true;
  }
}
