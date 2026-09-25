import { describe, expect, it } from 'vitest';

import { MaintenanceGuard } from '../presentation/guards/maintenance.guard';

const ctxFor = (method: string, url: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, url }) }) }) as never;
const noWindow = { current: async () => null } as never;
const guardWith = (state: unknown, windows: unknown = noWindow) =>
  new MaintenanceGuard({ get: async () => state } as never, windows as never);

describe('MaintenanceGuard', () => {
  it('off → everything passes', async () => {
    expect(
      await guardWith({ enabled: false }).canActivate(ctxFor('POST', '/api/v1/bookings')),
    ).toBe(true);
  });
  it('on → reads still work, writes get a retryable 503 with Retry-After', async () => {
    const g = guardWith({ enabled: true, message: 'Back at 2 AM' });
    expect(await g.canActivate(ctxFor('GET', '/api/v1/bookings/ABC'))).toBe(true);
    const err = await g.canActivate(ctxFor('POST', '/api/v1/bookings/hold')).then(
      () => null,
      (e: unknown) =>
        e as { status?: number; retryable?: boolean; retryAfterSeconds?: number; message?: string },
    );
    expect(err?.status).toBe(503);
    expect(err?.retryable).toBe(true);
    expect(err?.message).toBe('Back at 2 AM');
    expect((err?.retryAfterSeconds ?? 0) >= 60).toBe(true);
  });
  it('on → payment webhooks / callbacks and the toggle itself are exempt (money in flight must confirm)', async () => {
    const g = guardWith({ enabled: true });
    expect(await g.canActivate(ctxFor('POST', '/api/v1/payments/webhook/razorpay'))).toBe(true);
    expect(await g.canActivate(ctxFor('POST', '/api/v1/payments/verify'))).toBe(true);
    expect(await g.canActivate(ctxFor('PUT', '/api/v1/admin/platform/maintenance'))).toBe(true);
  });
  it('a settings read failure never takes the platform down (fails open)', async () => {
    const g = new MaintenanceGuard(
      {
        get: async () => {
          throw new Error('db down');
        },
      } as never,
      {
        current: async () => {
          throw new Error('db down');
        },
      } as never,
    );
    expect(await g.canActivate(ctxFor('POST', '/api/v1/bookings/hold'))).toBe(true);
  });
  it('a scheduled window that is running turns maintenance on by itself (#109)', async () => {
    const endsAt = new Date(Date.now() + 3_600_000);
    const g = guardWith(
      { enabled: false },
      {
        current: async () => ({ message: 'DB upgrade', endsAt }),
      },
    );
    const err = await g.canActivate(ctxFor('POST', '/api/v1/bookings/hold')).then(
      () => null,
      (e: unknown) => e as { status?: number; message?: string; retryAfterSeconds?: number },
    );
    expect(err?.status).toBe(503);
    expect(err?.message).toBe('DB upgrade');
    expect(err?.retryAfterSeconds).toBeGreaterThan(3_500);
  });
});
