import { describe, expect, it } from 'vitest';

import { MaintenanceGuard } from '../presentation/guards/maintenance.guard';

const ctxFor = (method: string, url: string) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ method, url }) }) }) as never;
const guardWith = (state: unknown) => new MaintenanceGuard({ get: async () => state } as never);

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
    const g = new MaintenanceGuard({
      get: async () => {
        throw new Error('db down');
      },
    } as never);
    expect(await g.canActivate(ctxFor('POST', '/api/v1/bookings/hold'))).toBe(true);
  });
});
