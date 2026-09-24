import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { throwError, TimeoutError as RxTimeoutError, type Observable } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

import { AppConfig } from '@config';
import { TimeoutError } from '@kernel';

import { REQUEST_TIMEOUT_KEY } from '../decorators/timeout.decorator';
import { Reflector } from '@nestjs/core';

/**
 * Per-request wall-clock budget.
 *
 * Without this, one pathological query holds a connection, a worker thread and
 * a socket indefinitely; a handful of them exhaust the pool and the whole API
 * stops. A hard deadline converts an unbounded failure into a bounded 504.
 *
 * The default comes from `HTTP_REQUEST_TIMEOUT_MS`; long-running endpoints
 * (report exports) opt out or extend with `@RequestTimeout(60_000)`.
 *
 * NOTE: this aborts the *response*, not the database statement. `statement_timeout`
 * (set on every connection in `pool.ts`) is what actually stops the query.
 * Both are needed.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly config: AppConfig,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const override = this.reflector.getAllAndOverride<number | undefined>(REQUEST_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const budget = override ?? this.config.http.requestTimeoutMs;
    if (budget <= 0) return next.handle();

    const operation = `${context.getClass().name}.${context.getHandler().name}`;

    return next.handle().pipe(
      timeout(budget),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof RxTimeoutError ? new TimeoutError(operation, budget) : error,
        ),
      ),
    );
  }
}
