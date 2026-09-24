import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppConfig, buildAppConfig, loadEnv } from '@config';

import { AppModule } from '@api/app.module';
import { configureApp, createFastifyAdapter } from '@api/bootstrap';

import { seedFixtures, type E2eFixtures } from './fixtures';

/**
 * Boots the real API — same adapter, prefix, versioning, filters and guards
 * as production — and returns a small request helper with fixtures.
 */
export interface HttpResult<T = any> {
  status: number;
  body: T;
}

export type Principal = 'customer' | 'operator' | 'platformAdmin' | 'anonymous';

export interface TestApp {
  post(path: string, body: unknown, opts?: CallOptions): Promise<HttpResult>;
  get(path: string, opts?: CallOptions): Promise<HttpResult>;
  close(): Promise<void>;
  fixtures: E2eFixtures;
  /** The Nest app, for tests that drive a service directly (e.g. a scheduled job). */
  nest: NestFastifyApplication;
}

interface CallOptions {
  as?: Principal;
  idempotencyKey?: string;
}

export async function bootstrapTestApp(): Promise<TestApp> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(buildAppConfig(loadEnv())),
    {
      logger: false,
      abortOnError: false,
    },
  );
  const config = app.get(AppConfig);
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const fixtures = await seedFixtures(app);
  const prefix = `/${config.app.apiPrefix}/v1`;

  const headersFor = (as: Principal): Record<string, string> => {
    switch (as) {
      case 'customer':
        return {
          authorization: `Bearer ${fixtures.customer.token}`,
          'x-tenant-id': fixtures.tenantId,
        };
      case 'operator':
        return {
          authorization: `Bearer ${fixtures.operatorToken}`,
          'x-tenant-slug': fixtures.tenantSlug,
        };
      case 'platformAdmin':
        return {
          authorization: `Bearer ${fixtures.platformAdminToken}`,
          'x-debug-surface': 'superAdmin',
        };
      default:
        return { 'x-tenant-id': fixtures.tenantId };
    }
  };

  const call = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: CallOptions = {},
  ): Promise<HttpResult> => {
    const res = await app.inject({
      method,
      url: `${prefix}${path}`,
      headers: {
        ...headersFor(opts.as ?? 'customer'),
        ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      },
      payload: body as never,
    });
    return {
      status: res.statusCode,
      body: res.body ? (JSON.parse(res.body) as unknown) : undefined,
    };
  };

  return {
    post: (p, b, o) => call('POST', p, b, o),
    get: (p, o) => call('GET', p, undefined, o),
    close: () => app.close(),
    fixtures,
    nest: app,
  };
}
