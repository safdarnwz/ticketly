import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'http:rateLimit';

export interface RateLimitSpec {
  limit: number;
  windowMs: number;
  /** Whose budget is consumed. `tenant` for authenticated B2B, `ip` for public. */
  scope: 'tenant' | 'ip';
}

/** Route-specific limit on top of the global tenant/IP limits. */
export const RateLimit = (limit: number, windowMs = 60_000, scope: RateLimitSpec['scope'] = 'ip'): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs, scope } satisfies RateLimitSpec);
