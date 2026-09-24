import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, of, type Observable } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';

import { AppConfig } from '@config';
import { AppError, ErrorCode, getContext, toAppError, type Uuid } from '@kernel';

import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';
import { IdempotencyStore } from './idempotency.store';

/**
 * ============================================================================
 *  Idempotency
 * ============================================================================
 *
 * THE PROBLEM: a passenger taps "Pay" on a flaky 3G connection. The request
 * reaches us, the booking is created, the response never arrives, the app
 * retries. Without idempotency that is two bookings and two charges.
 *
 * THE CONTRACT (deliberately identical to Stripe's, so integrators already
 * know it):
 *  - Client sends `Idempotency-Key: <uuid>` on any unsafe request.
 *  - The first request with that key executes and its response is stored.
 *  - Later requests with the same key return the STORED response plus
 *    `Idempotent-Replay: true`, re-executing nothing.
 *  - Same key + different body → 422 `IDEMPOTENCY.PAYLOAD_MISMATCH`. Silently
 *    returning the first response would be worse: the client would believe a
 *    different request had succeeded.
 *  - A concurrent duplicate while the first is still running → 409
 *    `IDEMPOTENCY.REQUEST_IN_PROGRESS`, which the client retries shortly.
 *
 * SCOPE: handlers annotated `@Idempotent()`. Every endpoint that moves money or
 * consumes seat inventory MUST be annotated; the architecture test in Part 10
 * fails the build otherwise.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly store: IdempotencyStore,
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http' || !this.config.security.idempotency.enabled) {
      return next.handle();
    }

    const required = this.reflector.getAllAndOverride<boolean | undefined>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const ctx = getContext();
    const key = ctx?.idempotencyKey;

    if (!key) {
      throw new AppError(ErrorCode.IDEMPOTENCY_KEY_REQUIRED, 400, {
        message: 'This endpoint requires an Idempotency-Key header',
        details: { header: 'Idempotency-Key' },
      });
    }

    const tenantId = ctx?.tenantId ?? null;
    const userId = (ctx?.userId ?? null) as Uuid | null;
    const fingerprint = IdempotencyStore.fingerprint(request.method, request.url, request.body);

    return from(
      this.store.claim({
        key,
        tenantId,
        userId,
        fingerprint,
        method: request.method,
        path: request.url,
        ttlSeconds: this.config.security.idempotency.ttlSeconds,
      }),
    ).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new AppError(ErrorCode.IDEMPOTENCY_PAYLOAD_MISMATCH, 422, {
              message: 'This Idempotency-Key was already used with a different request body',
            });
          }
          if (existing.status === 'in_progress') {
            throw new AppError(ErrorCode.IDEMPOTENCY_IN_PROGRESS, 409, {
              message: 'A request with this Idempotency-Key is still being processed',
              retryable: true,
              retryAfterSeconds: 1,
            });
          }
          void reply.header('Idempotent-Replay', 'true');
          void reply.status(existing.responseStatus ?? 200);
          return of(existing.responseBody);
        }

        return next.handle().pipe(
          tap({
            next: (body: unknown) => {
              void this.store.complete(key, tenantId, reply.statusCode || 200, body);
            },
          }),
          catchError((error: unknown) => {
            const appError = toAppError(error);
            // 4xx outcomes are deterministic — keep them so a retry replays the
            // same rejection. 5xx may be transient — release so a retry can run.
            if (appError.status >= 500) void this.store.release(key, tenantId);
            else void this.store.complete(key, tenantId, appError.status, appError.toPublicJSON());
            throw error;
          }),
        );
      }),
    );
  }
}
