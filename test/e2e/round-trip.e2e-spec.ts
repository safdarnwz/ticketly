import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, heldBooking, sqlOne, type TripLeg } from './support/flows';

/**
 * Round-trip discount (#283): an operator takes a % off the return journey
 * when it is booked against a confirmed onward booking with them — back the
 * way it came, leaving later, by the same customer or booking mobile — once.
 * Demo Travels' way back is JAI-DEL-01 (the demo seed, npm run db:seed:demo).
 */
describe('round-trip discount (e2e)', () => {
  let app: TestApp;
  let back: TripLeg;
  let onward: { bookingId: string; pnr: string };
  const op = { as: 'operator' as const };
  const setPct = (discountPct: number, opts: object = op) =>
    app.put('/concessions/round-trip', { discountPct }, opts);

  /** A free seat on a trip: not ladies-only or kept for accessibility, nobody on it, nobody holding it. */
  const freeSeat = async (tripId: string) =>
    (
      await sqlOne<{ seat_number: string }>(
        app,
        `SELECT ts.seat_number FROM trip_seats ts
          WHERE ts.trip_id = $1 AND ts.is_bookable AND NOT ts.ladies_only AND NOT ts.accessible
            AND ts.occupied_legs = 0 AND ts.blocked_legs = 0
            AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                             WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                               AND b.status = 'held' AND b.hold_expires_at > now())
          ORDER BY random() LIMIT 1`,
        [tripId],
      )
    ).seat_number;

  /** Quote + hold one seat on the way back, as the return of `returnOf`. */
  const holdReturn = async (
    returnOf: string | undefined,
    opts: { as?: 'customer' | 'anonymous'; phone?: string; leg?: TripLeg } = {},
  ) => {
    const leg = opts.leg ?? back;
    const seat = await freeSeat(leg.tripId);
    const quote = await app.post(
      '/pricing/quote',
      { ...leg, seatType: 'seater', seatNumbers: [seat] },
      { as: 'anonymous' },
    );
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: [seat],
        passengers: [{ seatNumber: seat, fullName: 'Round Tripper', age: 33, gender: 'female' }],
        contactPhone: opts.phone ?? app.fixtures.customer.phone,
        ...(returnOf ? { returnOf } : {}),
      },
      {
        as: opts.as ?? 'customer',
        idempotencyKey: `e2e-rt-${seat}-${Date.now()}-${Math.random()}`,
      },
    );
    return { hold, quoteTotal: quote.body.totalMinor as number };
  };

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const f = app.fixtures;
    // The demo's way back, a few days after the onward trip.
    const row = await sqlOne<{ id: string; from_stop: string; to_stop: string }>(
      app,
      `SELECT t.id,
              (SELECT stop_id FROM route_stops WHERE route_id = r.id ORDER BY sequence ASC LIMIT 1) AS from_stop,
              (SELECT stop_id FROM route_stops WHERE route_id = r.id ORDER BY sequence DESC LIMIT 1) AS to_stop
         FROM trips t JOIN routes r ON r.id = t.route_id
        WHERE r.code = 'JAI-DEL-01' AND t.status = 'open' AND t.journey_date > $1::date
        ORDER BY t.journey_date LIMIT 1`,
      [f.journeyDate],
    );
    expect(row?.id, 'run npm run db:seed:demo (it creates the JAI-DEL-01 trips)').toBeTruthy();
    back = { tripId: row.id, fromStopId: row.from_stop, toStopId: row.to_stop };
    const seat = await freeSeat(f.tripId);
    onward = await confirmedBooking(app, seat, {
      fullName: 'Round Tripper',
      age: 33,
      gender: 'female',
    });
  });
  afterAll(async () => {
    await setPct(0);
    await app.close();
  });

  it('only operator staff set the discount, 0–50%', async () => {
    expect((await setPct(51)).status).toBe(400);
    expect((await setPct(-1)).status).toBe(400);
    expect((await setPct(12.5)).status).toBe(400);
    expect((await app.put('/concessions/round-trip', { discountPct: 10 })).status).toBe(403);
    const ok = await setPct(10);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await app.get('/concessions', op)).body.roundTrip).toEqual({ discountPct: 10 });
    const checkout = await app.get('/concessions/checkout', {
      as: 'anonymous',
      headers: { 'x-tenant-id': app.fixtures.tenantId },
    });
    expect(checkout.body.roundTripDiscountPct).toBe(10);
  });

  it('the way back, booked against the onward booking, is 10% off — once', async () => {
    const { hold, quoteTotal } = await holdReturn(onward.bookingId);
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    expect(hold.body.roundTripDiscountMinor).toBe(Math.round(quoteTotal / 10));
    expect(hold.body.totalMinor).toBe(quoteTotal - hold.body.roundTripDiscountMinor);
    const saved = await sqlOne<{
      return_of: string;
      base_minor: string;
      discount_minor: string;
      tax_minor: string;
      total_minor: string;
    }>(
      app,
      'SELECT return_of, base_minor, discount_minor, tax_minor, total_minor FROM bookings WHERE id = $1',
      [hold.body.bookingId],
    );
    expect(saved.return_of).toBe(onward.bookingId);
    expect(Number(saved.base_minor) - Number(saved.discount_minor) + Number(saved.tax_minor)).toBe(
      Number(saved.total_minor),
    );

    // A second return on the same onward booking is refused while the first is live.
    const again = await holdReturn(onward.bookingId);
    expect(again.hold.status).toBe(409);
    expect(again.hold.body.detail).toMatch(/already booked/);
  });

  it('refuses a return that does not qualify, with the reason', async () => {
    // Someone else (not signed in, another mobile) cannot use this onward booking.
    const stranger = await holdReturn(onward.bookingId, { as: 'anonymous', phone: '9000012345' });
    expect(stranger.hold.status).toBe(422);
    expect(stranger.hold.body.detail).toMatch(/not found/);
    // The same direction again is not a return.
    const f = app.fixtures;
    const sameWay = await holdReturn(onward.bookingId, {
      leg: { tripId: f.tripId, fromStopId: f.fromStopId, toStopId: f.toStopId },
    });
    expect(sameWay.hold.status).toBe(422);
    expect(sameWay.hold.body.detail).toMatch(/back the way/);
    // An onward booking still awaiting payment does not count.
    const unpaid = await heldBooking(app, await freeSeat(f.tripId), {
      fullName: 'Not Paid',
      age: 40,
      gender: 'male',
    });
    const early = await holdReturn(unpaid.bookingId);
    expect(early.hold.status).toBe(422);
    expect(early.hold.body.detail).toMatch(/not confirmed/);
    // Another operator's booking id, or a made-up one, is not found.
    const madeUp = await holdReturn('01a0dd19-0000-7000-8000-000000000001');
    expect(madeUp.hold.status).toBe(422);
    expect(madeUp.hold.body.detail).toMatch(/not found/);
  });

  it('with no discount set, a return is booked at the full price', async () => {
    await setPct(0);
    const second = await confirmedBooking(app, await freeSeat(app.fixtures.tripId), {
      fullName: 'Full Price',
      age: 50,
      gender: 'male',
    });
    const { hold, quoteTotal } = await holdReturn(second.bookingId);
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    expect(hold.body.roundTripDiscountMinor).toBe(0);
    expect(hold.body.totalMinor).toBe(quoteTotal);
  });
});
