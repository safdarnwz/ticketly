import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppConfig } from '@config';
import { AppError, ErrorCode, getContext, toAppError } from '@kernel';
import { currentTraceId, Logger } from '@observability';

/**
 * ============================================================================
 *  Global exception filter → RFC 9457 `application/problem+json`
 * ============================================================================
 *
 * Every error leaves the system in exactly one shape:
 *
 *   {
 *     "type":     "https://errors.example.com/BOOKING.TRIP_ALREADY_DEPARTED",
 *     "title":    "Trip has already departed",
 *     "status":   422,
 *     "detail":   "Trip has already departed",
 *     "instance": "/api/v1/bookings/018f.../cancel",
 *     "code":     "BOOKING.TRIP_ALREADY_DEPARTED",
 *     "requestId":"018f...",
 *     "traceId":  "4bf92f...",
 *     "retryable": false,
 *     "errors":   { ... }        // only for validation failures
 *   }
 *
 * Why a standard envelope: OTA partners integrating against this API (Part 10)
 * write ONE error handler. Clients branch on `code`, never on prose. `requestId`
 * on the response is what turns "it failed" into a one-command log lookup.
 *
 * SECURITY: 5xx responses never carry internal detail. The stack trace goes to
 * the log (correlated by requestId), not to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log: Logger;

  constructor(
    logger: Logger,
    private readonly config: AppConfig,
  ) {
    this.log = logger.forContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();

    const appError = this.normalise(exception);
    const ctx = getContext();
    const traceId = currentTraceId();

    const body: Record<string, unknown> = {
      type: `${this.config.app.publicBaseUrl}/errors/${appError.code}`,
      title: appError.message,
      status: appError.status,
      detail:
        appError.status >= 500 && this.config.isProduction
          ? 'An unexpected error occurred'
          : appError.message,
      instance: request.url,
      code: appError.code,
      retryable: appError.retryable,
      ...(ctx ? { requestId: ctx.requestId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(appError.details !== undefined && appError.status < 500
        ? { errors: appError.details }
        : {}),
      timestamp: appError.timestamp,
    };

    // Non-production gets the stack inline; it saves a tab-switch during dev.
    if (!this.config.isProduction && appError.status >= 500) {
      body.stack = appError.stack?.split('\n').slice(0, 12);
    }

    this.logError(appError, request);

    if (appError.retryAfterSeconds !== undefined) {
      void reply.header('Retry-After', String(appError.retryAfterSeconds));
    }
    if (appError.status === 401) {
      void reply.header('WWW-Authenticate', `Bearer realm="${this.config.security.issuer}"`);
    }

    void reply.status(appError.status).type('application/problem+json').send(body);
  }

  private normalise(exception: unknown): AppError {
    if (AppError.is(exception)) return exception;

    // Nest's own HttpException (thrown by built-in guards/pipes we still use).
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] })?.message ?? exception.message);
      return new AppError(statusToCode(status), status, {
        message: Array.isArray(message) ? message.join('; ') : message,
        cause: exception,
        severity: status >= 500 ? 'error' : 'info',
      });
    }

    return toAppError(exception);
  }

  private logError(error: AppError, request: FastifyRequest): void {
    const payload = {
      err: error.toLogJSON(),
      method: request.method,
      url: request.url,
      // `routeOptions.url` is the *template* (`/bookings/:id`) — safe to log and
      // low-cardinality, unlike the raw url which contains ids.
      route: request.routeOptions?.url,
    };

    switch (error.severity) {
      case 'fatal':
      case 'error':
        this.log.error(error, 'request failed', payload);
        break;
      case 'warn':
        this.log.warn(payload, 'request rejected');
        break;
      default:
        this.log.debug(payload, 'request rejected');
    }
  }
}

function statusToCode(status: number): (typeof ErrorCode)[keyof typeof ErrorCode] {
  switch (status) {
    case 400:
      return ErrorCode.COMMON_VALIDATION;
    case 401:
      return ErrorCode.COMMON_UNAUTHENTICATED;
    case 403:
      return ErrorCode.COMMON_FORBIDDEN;
    case 404:
      return ErrorCode.COMMON_NOT_FOUND;
    case 409:
      return ErrorCode.COMMON_CONFLICT;
    case 413:
      return ErrorCode.COMMON_PAYLOAD_TOO_LARGE;
    case 415:
      return ErrorCode.COMMON_UNSUPPORTED_MEDIA;
    case 429:
      return ErrorCode.COMMON_RATE_LIMITED;
    case 503:
      return ErrorCode.COMMON_UNAVAILABLE;
    case 504:
      return ErrorCode.COMMON_TIMEOUT;
    default:
      return ErrorCode.COMMON_INTERNAL;
  }
}
