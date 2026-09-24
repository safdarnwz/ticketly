/**
 * Background worker entry point.
 *
 * Shares the exact same modules as the API — same code, same domain, same
 * repositories — but boots WITHOUT the HTTP server. It runs the outbox
 * dispatcher, schedulers and job consumers (fully implemented in Part 9).
 *
 * Running workers in a separate process from the API is deliberate:
 *  - a slow notification provider cannot consume the request-handling event
 *    loop and hurt booking latency;
 *  - workers scale on queue depth, the API scales on request rate — different
 *    signals, different replica counts;
 *  - a crash in a job handler restarts the worker, not the customer-facing API.
 */
import '@observability/tracing.bootstrap';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { buildAppConfig, loadEnv } from '@config';
import { Logger } from '@observability';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const config = buildAppConfig(loadEnv());
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger).forContext('Worker');
  app.useLogger(logger);
  app.flushLogs();
  app.enableShutdownHooks();

  logger.info({ concurrency: config.worker.jobConcurrency }, 'worker started');

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'worker shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`Fatal worker boot error: ${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
