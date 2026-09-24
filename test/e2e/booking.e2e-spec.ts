import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * End-to-end: the money-and-inventory-critical purchase flow against the real
 * API and Postgres — search, firm quote, hold (anti-double-sell gate), test-mode
 * payment (ledger + ticket issuance), signed boarding token.
 */
describe('booking flow (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const quoteFor = (seat: string) =>
    app.post('/pricing/quote', {
      tripId: app.fixtures.tripId,
      fromStopId: app.fixtures.fromStopId,
      toStopId: app.fixtures.toStopId,
      seatType: 'seater',
      seatNumbers: [seat],
    });

  it('search → quote → hold → pay → ticket → verify', async () => {
    const search = await app.post(
      '/search',
      {
        originCityId: app.fixtures.originCityId,
        destCityId: app.fixtures.destCityId,
        journeyDate: app.fixtures.journeyDate,
      },
      { as: 'anonymous' },
    );
    expect(search.status).toBe(200);
    const hit = search.body.results.find(
      (r: { tripId: string }) => r.tripId === app.fixtures.tripId,
    );
    expect(hit).toBeDefined();
    expect(hit.boardingStop.id).toBe(app.fixtures.fromStopId);

    const seat = app.fixtures.seatNumbers[0];
    const quote = await quoteFor(seat);
    expect(quote.status).toBe(200);

    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: [seat],
        passengers: [{ seatNumber: seat, fullName: 'E2E Traveller', age: 30 }],
        contactPhone: app.fixtures.customer.phone,
      },
      { idempotencyKey: `e2e-hold-${app.fixtures.customer.phone}` },
    );
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    expect(hold.body.pnr).toBeDefined();

    const pay = await app.post(
      '/payments/charge',
      { bookingId: hold.body.bookingId, method: 'upi', vpa: 'success@ticketly' },
      { idempotencyKey: `e2e-pay-${app.fixtures.customer.phone}` },
    );
    expect(pay.status).toBe(200);

    const tickets = await app.get(`/bookings/${hold.body.bookingId}/tickets`);
    expect(tickets.status).toBe(200);
    const token: string = tickets.body.tickets[0].boardingToken;
    expect(token).toContain('.');

    const verify = await app.post('/tickets/verify', { token }, { as: 'operator' });
    expect(verify.body.valid).toBe(true);
  });

  it('a second hold on the same seat/segment is refused (anti-double-sell)', async () => {
    const seat = app.fixtures.seatNumbers[1];
    const hold = async (name: string, key: string) =>
      app.post(
        '/bookings/hold',
        {
          quoteId: (await quoteFor(seat)).body.quoteId,
          seatNumbers: [seat],
          passengers: [{ seatNumber: seat, fullName: name }],
          contactPhone: app.fixtures.customer.phone,
        },
        { idempotencyKey: key },
      );
    expect((await hold('First', `e2e-a-${app.fixtures.customer.phone}`)).status).toBe(201);
    expect((await hold('Second', `e2e-b-${app.fixtures.customer.phone}`)).status).toBe(422);
  });
});
