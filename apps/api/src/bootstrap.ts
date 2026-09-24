import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import underPressure from '@fastify/under-pressure';
import { VersioningType, type INestApplication } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import type { AppConfig } from '@config';
import { setupSwagger } from '@http';
import type { Logger } from '@observability';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Fastify tuning and platform middleware.
 *
 * WHY FASTIFY AND NOT EXPRESS:
 *  - ~2-3x higher throughput on JSON workloads, and — more importantly — a
 *    much flatter p99, because responses are serialised by a schema-compiled
 *    function instead of generic `JSON.stringify` reflection.
 *  - Native async lifecycle: no `next(err)` callbacks silently swallowing
 *    rejections.
 *  - `under-pressure` gives us real load shedding, which is the difference
 *    between "slow for everyone" and "fast for most" during a festival surge.
 */
export function createFastifyAdapter(config: AppConfig): FastifyAdapter {
  return new FastifyAdapter({
    // Fastify generates its own ids; ours come from the request context so the
    // id is identical in logs, traces and the response header.
    genReqId: () => '',
    disableRequestLogging: true, // pino-http would duplicate our own logging
    bodyLimit: config.http.bodyLimitBytes,
    trustProxy: config.http.trustProxy,
    connectionTimeout: 0,
    keepAliveTimeout: config.http.keepAliveTimeoutMs,
    // Must exceed the load balancer's idle timeout, otherwise a reused
    // connection is closed mid-request and the LB reports a 502.
    requestTimeout: 0,
    maxParamLength: 256,
    ignoreTrailingSlash: true,
    caseSensitive: true,
  });
}

export async function configureApp(app: NestFastifyApplication, config: AppConfig): Promise<void> {
  const instance = app.getHttpAdapter().getInstance();
  instance.server.headersTimeout = config.http.headersTimeoutMs;

  // File uploads arrive as RAW bytes (Content-Type: application/octet-stream)
  // — no base64 inflation, no multipart parser. 5 MB (+ slack) is the hard
  // ceiling for any file (videos are not accepted at all); each purpose may
  // apply a smaller limit in FileService.upload.
  instance.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: 5 * 1024 * 1024 + 1024 },
    (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) =>
      done(null, body),
  );

  await app.register(helmet as never, {
    contentSecurityPolicy: false, // this is a JSON API; CSP belongs on the web app
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
  });

  await app.register(cors as never, {
    origin: buildCorsOriginMatcher(config.http.corsOrigins),
    credentials: config.http.corsCredentials,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Api-Key',
      'X-Tenant-Id',
      'X-Tenant-Slug',
      'X-Debug-Surface',
      'X-Request-Id',
      'X-Correlation-Id',
      'Idempotency-Key',
      'Accept-Language',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-Correlation-Id',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
      'Idempotent-Replay',
      'Server-Timing',
    ],
    maxAge: 86_400,
  });

  await app.register(compress as never, {
    // Below ~1KB compression costs more CPU than it saves bandwidth.
    threshold: 1_024,
    encodings: ['br', 'gzip', 'deflate'],
  });

  await app.register(cookie as never, { secret: config.security.jwtSecret });

  /**
   * LOAD SHEDDING. When the event loop is already 1s behind, accepting more
   * work makes every in-flight request slower and none of them succeed. Better
   * to return 503 immediately for a small slice so the rest stay fast.
   * Health endpoints are exempt so an overloaded instance can still be
   * observed and drained.
   */
  if (config.http.overload.maxEventLoopDelayMs > 0) {
    await app.register(underPressure as never, {
      maxEventLoopDelay: config.http.overload.maxEventLoopDelayMs,
      maxHeapUsedBytes: config.http.overload.maxHeapUsedBytes || undefined,
      maxRssBytes: config.http.overload.maxRssBytes || undefined,
      message: 'Server is under heavy load, please retry shortly',
      retryAfter: 5,
      exposeStatusRoute: false,
      pressureHandler: (
        _req: FastifyRequest,
        reply: FastifyReply,
        type: string,
        value: number | undefined,
      ) => {
        void reply
          .status(503)
          .header('Retry-After', '5')
          .send({
            type: 'about:blank',
            title: 'Service temporarily overloaded',
            status: 503,
            code: 'COMMON.SERVICE_UNAVAILABLE',
            detail: `Backpressure triggered by ${type} (${String(value)})`,
            retryable: true,
          });
      },
    });
  }

  app.setGlobalPrefix(config.app.apiPrefix, {
    // Probes and metrics must not sit behind the versioned API prefix; the
    // load balancer and Prometheus should not care about API versions.
    exclude: [
      'health',
      'health/live',
      'health/ready',
      'health/startup',
      config.observability.metricsPath.replace(/^\//, ''),
    ],
  });

  /**
   * URI versioning (`/api/v1/...`). Chosen over header versioning because it is
   * visible in logs, cacheable by CDNs and trivially testable with curl — all
   * of which matter when an OTA partner is debugging their integration.
   */
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1', prefix: 'v' });

  setupSwagger(app as INestApplication, config);
}

/**
 * Graceful shutdown.
 *
 * SEQUENCE, and why each step exists:
 *  1. Flip readiness to "draining" and WAIT `SHUTDOWN_DELAY_MS`. The load
 *     balancer needs time to notice and stop sending new requests. Skipping
 *     this is the number-one cause of 502s during a rolling deploy.
 *  2. Stop accepting new connections; let in-flight requests finish.
 *  3. Close Nest (`onModuleDestroy` → pools, Redis, worker loops).
 *  4. Hard-exit if any of that hangs past `SHUTDOWN_TIMEOUT_MS`, so a stuck
 *     connection cannot block a deploy indefinitely.
 */
export function installShutdownHandlers(
  app: NestFastifyApplication,
  config: AppConfig,
  logger: Logger,
  onDrain: () => void,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown initiated');

    const hardExit = setTimeout(() => {
      logger.fatal('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, config.shutdown.timeoutMs);
    hardExit.unref();

    try {
      onDrain();
      await new Promise((resolve) => setTimeout(resolve, config.shutdown.delayMs));
      await app.close();
      logger.info('shutdown complete');
      clearTimeout(hardExit);
      process.exit(0);
    } catch (error) {
      logger.error(error, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    // Log and keep serving: one bad promise must not take down an instance
    // that is happily handling thousands of other requests.
    logger.error(reason, 'unhandled promise rejection');
  });

  process.on('uncaughtException', (error) => {
    // An uncaught exception leaves the process in an undefined state. Log it,
    // then exit and let the supervisor restart us clean.
    logger.fatal({ err: { message: error.message, stack: error.stack } }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

/**
 * CORS origin matcher with wildcard-subdomain support.
 *
 * Ticketly runs one operator per subdomain (`https://app.<slug>.ticketly.com`),
 * so a plain exact-match origin list can't work — every new operator would
 * need a deploy. A configured entry like `https://*.ticketly.com` matches any
 * single subdomain label in that position (not `www.evil-ticketly.com.attacker.io`,
 * because the wildcard only ever substitutes one dot-delimited label).
 */
function buildCorsOriginMatcher(
  configuredOrigins: string[],
):
  | boolean
  | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void) {
  if (configuredOrigins.includes('*')) return true;

  const patterns = configuredOrigins.map((entry) => {
    const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+');
    return new RegExp(`^${escaped}$`);
  });

  return (origin, cb) => {
    // No Origin header (server-to-server, curl, same-origin) — allow.
    if (!origin) return cb(null, true);
    cb(
      null,
      patterns.some((pattern) => pattern.test(origin)),
    );
  };
}
