/**
 * MUST be the first import: OpenTelemetry patches `pg`, `http` and `ioredis`
 * at require time. Anything imported before it is invisible to tracing.
 */
import '@observability/tracing.bootstrap';

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import type { AppConfig } from '@config';
import { loadEnv } from '@config';
import { Logger } from '@observability';

import { AppModule } from './app.module';
import { configureApp, createFastifyAdapter, installShutdownHandlers } from './bootstrap';
import { ReadinessState } from './modules/system';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const { buildAppConfig } = await import('@config');
  const config: AppConfig = buildAppConfig(env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(config),
    {
      // We install our own pino logger as soon as the container is up; Nest's
      // default console logger is only used for boot-time messages.
      bufferLogs: true,
      // Handled by our global filter, which returns problem+json.
      abortOnError: false,
    },
  );

  const logger = app.get(Logger).forContext('Bootstrap');
  app.useLogger(logger);
  app.flushLogs();

  await configureApp(app, config);

  const readiness = app.get(ReadinessState);
  installShutdownHandlers(app, config, logger, () => readiness.drain());

  await app.listen({ port: config.http.port, host: config.http.host });
  readiness.markReady();

  logger.info(
    {
      port: config.http.port,
      env: config.env_,
      prefix: `/${config.app.apiPrefix}/v1`,
      docs: config.swagger.enabled ? `/${config.swagger.path}` : 'disabled',
      replicas: config.db.replicas.length,
      l2Cache: config.cache.l2Enabled,
      pid: process.pid,
    },
    `${config.app.name} listening`,
  );
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(`Fatal boot error: ${(error as Error)?.stack ?? String(error)}\n`);
  process.exit(1);
});
