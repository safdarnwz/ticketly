import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { createContext, isUuid, newId, runWithContext } from '@kernel';
import { currentTraceId } from '@observability';

/**
 * Establishes the ambient request context for the entire request lifetime.
 *
 * This is the FIRST middleware. Everything after it — guards, pipes,
 * interceptors, services, repositories, the logger — can read `getContext()`.
 *
 * `x-request-id` from the caller is accepted only when it is a valid UUID; a
 * client-controlled free-text id would let a caller poison log aggregation
 * (or inject newlines into log lines).
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: FastifyRequest['raw'], response: FastifyReply['raw'], next: () => void): void {
    const headers = request.headers;
    const incomingRequestId = single(headers['x-request-id']);
    const requestId = incomingRequestId && isUuid(incomingRequestId) ? incomingRequestId : newId();
    const correlationId = single(headers['x-correlation-id'])?.slice(0, 128) ?? requestId;

    const context = createContext({
      requestId,
      correlationId,
      traceId: currentTraceId(),
      ip: clientIp(request),
      userAgent: single(headers['user-agent'])?.slice(0, 256),
      method: request.method,
      route: request.url,
      idempotencyKey: single(headers['idempotency-key'])?.slice(0, 255),
    });

    // Echo the ids so a customer can quote them in a support ticket.
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-correlation-id', correlationId);

    runWithContext(context, next);
  }
}

function single(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the client IP behind a proxy.
 * We take the LAST entry of `x-forwarded-for` that we did not add ourselves —
 * taking the first is the classic mistake, because the client can forge the
 * left-hand entries and bypass IP rate limiting.
 */
function clientIp(request: FastifyRequest['raw']): string | undefined {
  const forwarded = single(request.headers['x-forwarded-for']);
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.socket?.remoteAddress ?? undefined;
}
