import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { Metrics, startTimer } from '@observability';

/**
 * RED metrics (Rate, Errors, Duration) for every request.
 *
 * The `route` label is the route TEMPLATE (`/api/v1/trips/:id`), never the
 * concrete URL. Labelling with the concrete URL would mint one time series per
 * trip id and take Prometheus down within a day — the single most common way
 * teams break their own monitoring.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: Metrics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const method = request.method;
    const stop = startTimer();

    this.metrics.httpInFlight.inc({ method });

    const record = (): void => {
      const route = request.routeOptions?.url ?? 'unmatched';
      const status = String(reply.statusCode);
      const seconds = stop();
      this.metrics.httpInFlight.dec({ method });
      this.metrics.httpRequests.inc({ method, route, status });
      this.metrics.httpDuration.observe({ method, route, status }, seconds);
      // Server-Timing lets browsers and synthetic monitors see backend time
      // without correlating logs.
      void reply.header('Server-Timing', `app;dur=${(seconds * 1000).toFixed(1)}`);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
