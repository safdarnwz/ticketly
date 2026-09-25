import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * The operator's customers. Customers hold one platform-wide account, but the
 * customer list looked for accounts of the operator's own tenant — so it was
 * always empty, and "blacklisting" silently blocked nobody. Customers now come
 * from the operator's bookings, and a block stops new bookings with that
 * operator only, by account and by mobile.
 */
describe('customers (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let booking: { bookingId: string; pnr: string };
  const op = { as: 'operator' as const };

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const login = await app.post(
      '/auth/login',
      { identifier: 'admin@maharaja-yatra.example', password: 'pass@123' },
      { headers: { 'x-tenant-slug': 'maharaja-yatra', 'x-debug-surface': 'tenantAdmin' } },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    otherOperator = {
      authorization: `Bearer ${login.body.accessToken}`,
      'x-tenant-slug': 'maharaja-yatra',
    };
    booking = await confirmedBooking(app, app.fixtures.seatNumbers[3], {
      fullName: 'Loyal Rider',
      age: 50,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const hold = (contactPhone: string) =>
    app
      .post('/pricing/quote', {
        tripId: app.fixtures.tripId,
        fromStopId: app.fixtures.fromStopId,
        toStopId: app.fixtures.toStopId,
        seatType: 'seater',
        seatNumbers: [app.fixtures.seatNumbers[3]],
      })
      .then((q) =>
        app.post(
          '/bookings/hold',
          {
            quoteId: q.body.quoteId,
            seatNumbers: [app.fixtures.seatNumbers[3]],
            passengers: [
              { seatNumber: app.fixtures.seatNumbers[3], fullName: 'Blocked Try', age: 40 },
            ],
            contactPhone,
          },
          { idempotencyKey: `e2e-block-${contactPhone}-${Date.now()}` },
        ),
      );

  it('lists who booked, found by PNR, mobile or name', async () => {
    const byPnr = await app.get(`/customers?q=${booking.pnr}`, op);
    expect(byPnr.status, JSON.stringify(byPnr.body)).toBe(200);
    expect(byPnr.body.items).toHaveLength(1);
    const c = byPnr.body.items[0];
    expect(c).toMatchObject({ phone: app.fixtures.customer.phone.slice(-10), blocked: false });
    expect(c.trips).toBeGreaterThanOrEqual(1);
    expect(c.spentMinor).toBeGreaterThan(0);
    expect(c.phone).not.toMatch(/^v1:/); // never the encrypted account field

    const byPhone = await app.get(`/customers?q=${app.fixtures.customer.phone.slice(-6)}`, op);
    expect(byPhone.body.items.some((x: { key: string }) => x.key === c.key)).toBe(true);

    const profile = await app.get(`/customers/${c.key}`, op);
    expect(profile.status).toBe(200);
    expect(profile.body.history.some((b: { pnr: string }) => b.pnr === booking.pnr)).toBe(true);
    expect(profile.body.block).toBeNull();

    // Another operator never had this customer.
    expect((await app.get(`/customers/${c.key}`, { headers: otherOperator })).status).toBe(404);
    expect((await app.get('/customers/not-a-key', op)).status).toBe(404);
  });

  it('a block stops new bookings with this operator, by account and by mobile', async () => {
    const c = (await app.get(`/customers?q=${booking.pnr}`, op)).body.items[0];
    const block = (body: object, headers?: Record<string, string>) =>
      app.post(`/customers/${c.key}/block`, body, headers ? { headers } : op);
    expect((await block({ reason: 'no' })).status).toBe(400);
    expect((await block({ reason: 'Abused the driver' }, otherOperator)).status).toBe(404);
    expect((await block({ reason: 'Abused the driver on 12 Sept' })).status).toBe(200);
    try {
      expect((await block({ reason: 'Again, the same person' })).status).toBe(409);
      const blockedHold = await hold(app.fixtures.customer.phone);
      expect(blockedHold.status).toBe(403);
      expect(blockedHold.body.detail).toMatch(/not taking bookings/);
      // A different mobile does not help: the signed-in account is blocked too.
      expect((await hold('9123400001')).status).toBe(403);

      const blocked = await app.get('/customers?filter=blocked', op);
      expect(blocked.body.items.some((x: { key: string }) => x.key === c.key)).toBe(true);
      const profile = await app.get(`/customers/${c.key}`, op);
      expect(profile.body.block).toMatchObject({ reason: 'Abused the driver on 12 Sept' });
      // Existing bookings stay as they are.
      expect(profile.body.history.find((b: { pnr: string }) => b.pnr === booking.pnr)?.status).toBe(
        'confirmed',
      );
    } finally {
      expect((await app.post(`/customers/${c.key}/unblock`, {}, op)).status).toBe(200);
    }
    expect((await app.post(`/customers/${c.key}/unblock`, {}, op)).status).toBe(404);
  });
});
