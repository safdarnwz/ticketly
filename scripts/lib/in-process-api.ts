/**
 * Boots the real API inside this process — same adapter, prefix, filters,
 * guards and validation as the server — and lets a script call its HTTP
 * endpoints without a running server or a network port (Fastify's inject).
 * Seeds use it so demo data goes through exactly the paths a person using
 * the consoles would: validation, permissions, encryption, idempotency.
 */
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppConfig, buildAppConfig, loadEnv } from '@config';

import { AppModule } from '@api/app.module';
import { configureApp, createFastifyAdapter } from '@api/bootstrap';

export type Headers = Record<string, string>;

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export interface InProcessApi {
  nest: NestFastifyApplication;
  config: AppConfig;
  call<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Headers,
    idempotencyKey?: string,
  ): Promise<ApiResult<T>>;
  close(): Promise<void>;
}

export async function startInProcessApi(): Promise<InProcessApi> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(buildAppConfig(loadEnv())),
    { logger: ['error'], abortOnError: false },
  );
  const config = app.get(AppConfig);
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const prefix = `/${config.app.apiPrefix}/v1`;

  return {
    nest: app,
    config,
    async call(method, path, body, headers = {}, idempotencyKey) {
      const h: Headers = { ...headers };
      let payload: string | Buffer | undefined;
      if (body instanceof Uint8Array) {
        h['content-type'] = 'application/octet-stream';
        payload = Buffer.from(body);
      } else if (body !== undefined) {
        h['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      if (idempotencyKey) h['idempotency-key'] = idempotencyKey;
      const res = await app.inject({ method, url: prefix + path, headers: h, payload });
      let parsed: unknown = res.body;
      try {
        parsed = res.body ? JSON.parse(res.body) : null;
      } catch {
        /* not JSON */
      }
      return { status: res.statusCode, body: parsed as never };
    },
    close: () => app.close(),
  };
}

/** The body when the status is 2xx; otherwise an error with the API's own message. */
export function ok<T>(r: ApiResult<T>, what: string): T {
  if (r.status < 200 || r.status >= 300) {
    const detail =
      (r.body as { detail?: string } | null)?.detail ?? JSON.stringify(r.body).slice(0, 400);
    throw new Error(`${what}: ${r.status} ${detail}`);
  }
  return r.body;
}
