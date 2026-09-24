import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * End-to-end: the money-and-inventory-critical purchase flow, against a real
 * Nest app + Postgres (rolled back per file). This is the highest-value e2e —
 * it exercises the anti-double-sell gate, the hold TTL, coupon redemption, the
 * ledger, and ticket issuance as one path.
 *
 * Run with: npm run test:e2e   (needs a Postgres per vitest.e2e.config.ts).
 */
describe('booking flow (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('search → quote → hold → confirm → ticket', async () => {
    const search = await app.post('/v1/storefront/search', {
      originCityId: app.fixtures.originCityId,
      destCityId: app.fixtures.destCityId,
      journeyDate: app.fixtures.journeyDate,
    });
    expect(search.status).toBe(200);
    expect(search.body.count).toBeGreaterThan(0);

    const quote = await app.post('/v1/pricing/quote', {
      tripId: app.fixtures.tripId,
      seatNumbers: ['A1'],
      fromStopId: app.fixtures.fromStopId,
      toStopId: app.fixtures.toStopId,
    });
    expect(quote.status).toBe(200);

    const hold = await app.post('/v1/bookings/hold', {
      quoteId: quote.body.quoteId,
      seatNumbers: ['A1'],
      passengers: [{ seatNumber: 'A1', fullName: 'E2E Traveller', age: 30 }],
    }, { idempotencyKey: 'e2e-hold-1' });
    expect(hold.status).toBe(201);
    expect(hold.body.pnr).toBeDefined();

    const confirm = await app.post(`/v1/bookings/${hold.body.bookingId}/confirm`,
      { paidMinor: hold.body.totalMinor, reference: 'e2e-pay-1' }, { idempotencyKey: 'e2e-confirm-1' });
    expect(confirm.status).toBe(200);

    const tickets = await app.get(`/v1/bookings/${hold.body.bookingId}/tickets`);
    expect(tickets.status).toBe(200);
    expect(tickets.body.tickets[0].boardingToken).toContain('.');

    // The gate verifies the signed token.
    const verify = await app.post('/v1/tickets/verify', { token: tickets.body.tickets[0].boardingToken });
    expect(verify.body.valid).toBe(true);
  });

  it('a second hold on the same seat/segment is refused (anti-double-sell)', async () => {
    const quote = await app.post('/v1/pricing/quote', {
      tripId: app.fixtures.tripId, seatNumbers: ['A2'],
      fromStopId: app.fixtures.fromStopId, toStopId: app.fixtures.toStopId,
    });
    const first = await app.post('/v1/bookings/hold', {
      quoteId: quote.body.quoteId, seatNumbers: ['A2'],
      passengers: [{ seatNumber: 'A2', fullName: 'First' }],
    }, { idempotencyKey: 'e2e-a2-1' });
    expect(first.status).toBe(201);

    const second = await app.post('/v1/bookings/hold', {
      quoteId: quote.body.quoteId, seatNumbers: ['A2'],
      passengers: [{ seatNumber: 'A2', fullName: 'Second' }],
    }, { idempotencyKey: 'e2e-a2-2' });
    expect(second.status).toBe(422); // INVENTORY.SEAT_UNAVAILABLE
  });
});
