import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * The operator's bookings console: the list (filters, paging, today in the
 * operator's time zone), the booking detail, cancelling some seats (only the
 * operator, the booking's customer or its mobile — it used to be open to
 * anyone), and re-sending the e-ticket.
 */
describe('operator bookings (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let family: { bookingId: string; pnr: string; seats: string[] };
  const op = { as: 'operator' as const };
  const anon = { as: 'anonymous' as const };

  /** Quote, hold and pay seats on the fixture trip as the fixture customer. */
  const book = async (seats: string[], email?: string) => {
    const f = app.fixtures;
    const quote = await app.post('/pricing/quote', {
      tripId: f.tripId,
      fromStopId: f.fromStopId,
      toStopId: f.toStopId,
      seatType: 'seater',
      seatNumbers: seats,
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    const key = `${seats.join('.')}-${Date.now()}`;
    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: seats,
        passengers: seats.map((s, i) => ({
          seatNumber: s,
          fullName: `Family ${i + 1}`,
          age: 30 + i,
        })),
        contactPhone: f.customer.phone,
        contactEmail: email,
      },
      { idempotencyKey: `e2e-ob-hold-${key}` },
    );
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    const pay = await app.post(
      '/payments/charge',
      { bookingId: hold.body.bookingId, method: 'upi', vpa: 'success@ticketly' },
      { idempotencyKey: `e2e-ob-pay-${key}` },
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    return { bookingId: hold.body.bookingId as string, pnr: hold.body.pnr as string, seats };
  };

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
    family = await book(app.fixtures.seatNumbers.slice(0, 3), `family.${Date.now()}@example.in`);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('bookings list', () => {
    it('finds by PNR, mobile and ticket number on any date', async () => {
      const byPnr = await app.get(`/bookings/search?pnr=${family.pnr.toLowerCase()}`, op);
      expect(byPnr.status, JSON.stringify(byPnr.body)).toBe(200);
      expect(byPnr.body.items).toHaveLength(1);
      expect(byPnr.body.items[0]).toMatchObject({
        pnr: family.pnr,
        status: 'confirmed',
        seatCount: 3,
        seats: family.seats,
        leadPassenger: 'Family 1',
      });
      const mobile = app.fixtures.customer.phone.slice(-10);
      const byMobile = await app.get(
        `/bookings/search?mobile=${encodeURIComponent(`+91 ${mobile}`)}`,
        op,
      );
      expect(byMobile.body.items.some((b: { pnr: string }) => b.pnr === family.pnr)).toBe(true);
      const byTicket = await app.get(
        `/bookings/search?ticket=${family.pnr}-${family.seats[1]}`,
        op,
      );
      expect(byTicket.body.items.map((b: { pnr: string }) => b.pnr)).toEqual([family.pnr]);
    });

    it('lists a period by journey date, filtered by trip and status, and pages', async () => {
      const f = app.fixtures;
      const q = `from=${f.journeyDate}&to=${f.journeyDate}&dateBasis=journey&tripId=${f.tripId}`;
      const all = await app.get(`/bookings/search?${q}&limit=1`, op);
      expect(all.status).toBe(200);
      expect(all.body.items).toHaveLength(1);
      if (all.body.hasMore) {
        const next = await app.get(
          `/bookings/search?${q}&limit=1&cursor=${encodeURIComponent(all.body.nextCursor)}`,
          op,
        );
        expect(next.body.items[0].id).not.toBe(all.body.items[0].id);
      }
      const confirmed = await app.get(`/bookings/search?${q}&status=confirmed&limit=200`, op);
      expect(
        confirmed.body.items.every(
          (b: { status: string; tripId: string }) =>
            b.status === 'confirmed' && b.tripId === f.tripId,
        ),
      ).toBe(true);
      expect(confirmed.body.items.some((b: { pnr: string }) => b.pnr === family.pnr)).toBe(true);
    });

    it('filters by channel, agent and no-shows', async () => {
      const wide = 'dateBasis=journey&from=2026-01-01&to=2026-03-31&limit=200';
      const byAgent = await app.get(
        `/bookings/search?${wide}&agentId=01a0dddd-0000-7000-8000-000000000000`,
        op,
      );
      expect(byAgent.status).toBe(200);
      expect(byAgent.body.items).toEqual([]);
      const phone = await app.get(`/bookings/search?${wide}&channel=phone`, op);
      expect(phone.status).toBe(200);
      expect(phone.body.items.every((b: { channel: string }) => b.channel === 'phone')).toBe(true);
      const noShows = await app.get(`/bookings/search?${wide}&noShow=1`, op);
      expect(noShows.status).toBe(200);
      expect(
        noShows.body.items.every((b: { noShowSeats: string[] }) => b.noShowSeats.length > 0),
      ).toBe(true);
      expect((await app.get('/bookings/search?channel=pigeon', op)).status).toBe(400);
      const byBranch = await app.get(
        `/bookings/search?${wide}&branchId=01a0dddd-0000-7000-8000-000000000000`,
        op,
      );
      expect(byBranch.status).toBe(200);
      expect(byBranch.body.items).toEqual([]);
      expect((await app.get('/bookings/search?branchId=nope', op)).status).toBe(400);
    });

    it('defaults to today and rejects bad input', async () => {
      const today = await app.get('/bookings/search', op);
      expect(today.status).toBe(200);
      expect(today.body.from).toBe(today.body.to);
      const bad = async (qs: string) => (await app.get(`/bookings/search?${qs}`, op)).status;
      expect(await bad('from=2026-10-10&to=2026-10-01')).toBe(400);
      expect(await bad('from=2026-01-01&to=2026-12-31')).toBe(400);
      expect(await bad('status=paid')).toBe(400);
      expect(await bad('limit=500')).toBe(400);
      expect(await bad('cursor=garbage')).toBe(400);
      expect(await bad('tripId=nope')).toBe(400);
    });

    it("never shows another operator's bookings, and needs staff", async () => {
      const other = await app.get(`/bookings/search?pnr=${family.pnr}`, { headers: otherOperator });
      expect(other.status).toBe(200);
      expect(other.body.items).toEqual([]);
      expect(
        (await app.get(`/bookings/by-pnr-staff/${family.pnr}`, { headers: otherOperator })).status,
      ).toBe(404);
      expect([401, 403]).toContain((await app.get('/bookings/search', anon)).status);
      expect((await app.get('/bookings/search')).status).toBe(403); // a customer
    });

    it('the detail carries journey, passengers and email status', async () => {
      const r = await app.get(`/bookings/by-pnr-staff/${family.pnr}`, op);
      expect(r.status).toBe(200);
      expect(r.body.detail).toMatchObject({ pnr: family.pnr, seatCount: 3 });
      expect(r.body.passengers.map((p: { seatNumber: string }) => p.seatNumber)).toEqual(
        family.seats,
      );
      expect(r.body.emails).toBeTypeOf('object');
    });
  });

  describe('dashboard numbers', () => {
    it("count today's sales in the operator's day", async () => {
      const r = await app.get('/reports/summary', op);
      expect(r.status).toBe(200);
      for (const k of [
        'todayBookings',
        'todaySeats',
        'todayRevenueMinor',
        'liveHolds',
        'liveHoldSeats',
        'totalBookings',
      ])
        expect(typeof r.body[k]).toBe('number');
      expect(r.body.todayBookings).toBeGreaterThanOrEqual(1);
      expect(r.body.totalBookings).toBeGreaterThanOrEqual(r.body.todayBookings);
    });

    it("lists a day's trips with paid and in-payment seats", async () => {
      const r = await app.get(`/scheduling/trips?date=${app.fixtures.journeyDate}`, op);
      expect(r.status).toBe(200);
      const trip = r.body.items.find((t: { id: string }) => t.id === app.fixtures.tripId);
      expect(trip.bookedSeats).toBeGreaterThanOrEqual(3);
      expect(typeof trip.heldSeats).toBe('number');
      expect(
        r.body.items.every((t: { journeyDate: string }) =>
          t.journeyDate.startsWith(app.fixtures.journeyDate),
        ),
      ).toBe(true);
      expect((await app.get('/scheduling/trips?date=tomorrow', op)).status).toBe(400);
    });
  });

  describe('cancelling some seats', () => {
    const path = () => `/bookings/${family.bookingId}/cancel-seats`;
    const body = (extra: object = {}) => ({
      seatNumbers: [family.seats[2]],
      reason: 'drop out',
      ...extra,
    });

    it('is refused without proof, with the wrong mobile, or by another operator', async () => {
      expect(
        (await app.post(path(), body(), { ...anon, idempotencyKey: `cs-a-${Date.now()}` })).status,
      ).toBe(404);
      expect(
        (
          await app.post(path(), body({ mobile: '9000000000' }), {
            ...anon,
            idempotencyKey: `cs-b-${Date.now()}`,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await app.post(path(), body(), {
            headers: otherOperator,
            idempotencyKey: `cs-c-${Date.now()}`,
          })
        ).status,
      ).toBe(404);
    });

    it('a customer cannot send the refund to another account', async () => {
      const r = await app.post(
        path(),
        body({
          mobile: app.fixtures.customer.phone,
          refundDestination: 'alternate_account',
          altAccountDetails: {
            accountHolder: 'Someone Else',
            accountNumber: '123456789012',
            ifsc: 'HDFC0000001',
          },
        }),
        { ...anon, idempotencyKey: `cs-d-${Date.now()}` },
      );
      expect(r.status).toBe(403);
    });

    it('the booking mobile cancels one seat; the rest stay confirmed', async () => {
      const r = await app.post(path(), body({ mobile: app.fixtures.customer.phone }), {
        ...anon,
        idempotencyKey: `cs-e-${Date.now()}`,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.remainingSeats).toBe(2);
      const after = await app.get(`/bookings/search?pnr=${family.pnr}`, op);
      expect(after.body.items[0], JSON.stringify(after.body.items[0])).toMatchObject({
        status: 'confirmed',
        seatCount: 2,
      });
    });

    it('operator staff cancel another seat of it', async () => {
      const r = await app.post(
        path(),
        { seatNumbers: [family.seats[1]], reason: 'counter' },
        { ...op, idempotencyKey: `cs-f-${Date.now()}` },
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.remainingSeats).toBe(1);
    });
  });

  describe('resending the e-ticket', () => {
    it('staff send it to the booking email or another one', async () => {
      const path = `/bookings/${family.bookingId}/tickets/resend`;
      expect((await app.post(path, {}, op)).status).toBe(200);
      expect((await app.post(path, { email: 'desk.copy@example.in' }, op)).status).toBe(200);
      expect((await app.post(path, { email: 'not-an-email' }, op)).status).toBe(400);
      expect((await app.post(path, {}, { headers: otherOperator })).status).toBe(422);
      expect((await app.post(path, {})).status).toBe(403); // the customer
    });

    it('an unpaid booking has no ticket to send', async () => {
      const f = app.fixtures;
      const quote = await app.post('/pricing/quote', {
        tripId: f.tripId,
        fromStopId: f.fromStopId,
        toStopId: f.toStopId,
        seatType: 'seater',
        seatNumbers: [f.seatNumbers[3]],
      });
      const hold = await app.post(
        '/bookings/hold',
        {
          quoteId: quote.body.quoteId,
          seatNumbers: [f.seatNumbers[3]],
          passengers: [{ seatNumber: f.seatNumbers[3], fullName: 'Not Paid' }],
          contactPhone: f.customer.phone,
          contactEmail: 'unpaid@example.in',
        },
        { idempotencyKey: `e2e-ob-unpaid-${Date.now()}` },
      );
      const r = await app.post(`/bookings/${hold.body.bookingId}/tickets/resend`, {}, op);
      expect(r.status).toBe(422);
    });
  });
});
