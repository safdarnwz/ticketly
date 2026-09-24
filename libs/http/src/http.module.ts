import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { CacheModule } from '@cache';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { ObservabilityModule } from '@observability';

import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { IdempotencyStore } from './idempotency/idempotency.store';
import { HttpMetricsInterceptor } from './interceptors/http-metrics.interceptor';
import { SerializationInterceptor } from './interceptors/serialization.interceptor';
import { TimeoutInterceptor } from './interceptors/timeout.interceptor';
import { RequestContextMiddleware } from './middleware/request-context.middleware';
import { RateLimiter } from './ratelimit/rate-limiter';

/**
 * Wires the HTTP cross-cutting layer.
 *
 * INTERCEPTOR ORDER MATTERS (Nest runs them outermost-first on the way in and
 * innermost-first on the way out):
 *
 *   metrics → timeout → idempotency → serialization → [handler]
 *
 *  - metrics outermost so it times everything, including rejections;
 *  - timeout outside idempotency so a stuck handler still releases its key;
 *  - idempotency outside serialization so the STORED body is the normalised
 *    one the first caller received — a replay must be byte-identical.
 */
@Global()
@Module({
  imports: [ConfigModule, ObservabilityModule, DatabaseModule, CacheModule],
  providers: [
    IdempotencyStore,
    RateLimiter,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: SerializationInterceptor },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [IdempotencyStore, RateLimiter],
})
export class HttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
