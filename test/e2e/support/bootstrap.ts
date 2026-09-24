import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from '@api/app.module';

/**
 * Boots the real Nest application on Fastify for e2e tests and returns a small
 * request helper. Each e2e file runs inside a transaction that is rolled back on
 * `close()` (see libs/testing), so tests never leak state into each other.
 *
 * Fixtures (a demo tenant, a published trip with free seats, an authed customer
 * + operator token) are provisioned once per file by the seed builder.
 */
export interface HttpResult<T = any> {
  status: number;
  body: T;
}

export interface TestApp {
  post(path: string, body: unknown, opts?: { idempotencyKey?: string }): Promise<HttpResult>;
  get(path: string): Promise<HttpResult>;
  asOperator(): TestApp;
  close(): Promise<void>;
  fixtures: {
    originCityId: string;
    destCityId: string;
    journeyDate: string;
    tripId: string;
    fromStopId: string;
    toStopId: string;
    bookingId: string;
  };
}

export async function bootstrapTestApp(): Promise<TestApp> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const fixtures = await seedFixtures(app);
  let token = fixtures.customerToken;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    opts?: { idempotencyKey?: string },
  ): Promise<HttpResult> => {
    const res = await app.inject({
      method: method as never,
      url: path,
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant': fixtures.tenantSlug,
        ...(opts?.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
      },
      payload: body as never,
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : undefined };
  };

  const api: TestApp = {
    post: (p, b, o) => call('POST', p, b, o),
    get: (p) => call('GET', p),
    asOperator: () => {
      token = fixtures.operatorToken;
      return api;
    },
    close: () => app.close(),
    fixtures: fixtures.public,
  };
  return api;
}

// Provisions the demo tenant + a bookable trip and returns tokens + ids.
// Implemented against the seed builders in libs/testing.
declare function seedFixtures(app: NestFastifyApplication): Promise<{
  tenantSlug: string;
  customerToken: string;
  operatorToken: string;
  public: TestApp['fixtures'];
}>;
