import { context, SpanStatusCode, trace, type Span, type Tracer } from '@opentelemetry/api';

import { toAppError } from '@kernel';

/**
 * OpenTelemetry helpers.
 *
 * The SDK itself is started in `tracing.bootstrap.ts` BEFORE any other import,
 * because auto-instrumentation must patch `pg`, `http` and `ioredis` before
 * they are first required.
 *
 * These helpers exist so feature code never imports the OTel API directly and
 * so a span is always closed and always records its error.
 */
const TRACER_NAME = 'ticketly';

export function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/** Run `fn` inside a span. The span is ended and error-marked automatically. */
export async function traced<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {},
): Promise<T> {
  return tracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const appError = toAppError(error);
      span.recordException(appError);
      span.setStatus({ code: SpanStatusCode.ERROR, message: appError.message });
      span.setAttribute('error.code', appError.code);
      throw error;
    } finally {
      span.end();
    }
  });
}

/** Current W3C trace id, for stamping onto logs and error responses. */
export function currentTraceId(): string | undefined {
  const span = trace.getSpan(context.active());
  const id = span?.spanContext().traceId;
  return id && id !== '00000000000000000000000000000000' ? id : undefined;
}

/** Attach a business attribute to the active span (cheap no-op if untraced). */
export function annotate(attributes: Record<string, string | number | boolean>): void {
  trace.getSpan(context.active())?.setAttributes(attributes);
}

export function addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  trace.getSpan(context.active())?.addEvent(name, attributes);
}
