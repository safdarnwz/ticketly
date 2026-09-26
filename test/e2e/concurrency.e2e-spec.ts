import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, heldBooking, sqlOne } from './support/flows';

/**
 * Races the booking flow must survive (scenarios 901–998): requests fired at
 * the same moment, repeated with the same idempotency key, or arriving after
 * the state they relied on has changed. Each is fired for real, in parallel,
 * against the running app — the database row locks and the idempotency store
 * are what keep the outcome single.
 */
describe('concurrency (e2e)', () => {
  let app: TestApp;
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const op = { as: 'operator' as const };

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const quote = (seat: string) =>
    app.post('/pricing/quote', {
      tripId: app.fixtures.tripId,
      fromStopId: app.fixtures.fromStopId,
      toStopId: app.fixtures.toStopId,
      seatType: 'seater',
      seatNumbers: [seat],
    });
  const holdBody = async (seat: string, name: string) => ({
    quoteId: (await quote(seat)).body.quoteId,
    seatNumbers: [seat],
    passengers: [{ seatNumber: seat, fullName: name }],
    contactPhone: app.fixtures.customer.phone,
  });

  it('many buyers grab the same seat at once: exactly one gets it (901, 908, 951, 952)', async () => {
    const seat = app.fixtures.seatNumbers[0];
    const bodies = await Promise.all([1, 2, 3, 4, 5].map((i) => holdBody(seat, `Racer ${i}`)));
    const results = await Promise.all(
      bodies.map((b, i) => app.post('/bookings/hold', b, { idempotencyKey: `race-${run}-${i}` })),
    );
    const won = results.filter((r) => r.status === 201);
    expect(won, JSON.stringify(results.map((r) => r.status))).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect([409, 422]).toContain(r.status);
      expect(r.body.detail).toBeTruthy(); // a message the checkout shows…
      // …and a code it recognises, sending the buyer back to pick another seat.
      expect(r.body.code).toBe('INVENTORY.SEAT_UNAVAILABLE');
    }
    const held = await sqlOne<{ n: string }>(
      app,
      `SELECT count(*) AS n FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.trip_id = $1 AND bs.seat_number = $2
          AND b.status = 'held' AND b.hold_expires_at > now()`,
      [app.fixtures.tripId, seat],
    );
    expect(Number(held.n)).toBe(1);
  });

  it('a double click (same idempotency key, in parallel) makes one booking (911, 912, 914)', async () => {
    const seat = app.fixtures.seatNumbers[1];
    const body = await holdBody(seat, 'Double Click');
    const key = `dbl-${run}`;
    const results = await Promise.all(
      [1, 2, 3].map(() => app.post('/bookings/hold', body, { idempotencyKey: key })),
    );
    for (const r of results) expect([201, 409]).toContain(r.status);
    const ids = new Set(results.filter((r) => r.status === 201).map((r) => r.body.bookingId));
    expect(ids.size).toBe(1);
    // A later retry returns the same booking, and the same key with another body is refused.
    const again = await app.post('/bookings/hold', body, { idempotencyKey: key });
    expect(again.body.bookingId).toBe([...ids][0]);
    expect(
      (
        await app.post(
          '/bookings/hold',
          { ...body, passengers: [{ seatNumber: seat, fullName: 'Someone Else' }] },
          { idempotencyKey: key },
        )
      ).status,
    ).toBe(422);
  });

  it('a booking call without an idempotency key is refused (913)', async () => {
    const r = await app.post(
      '/bookings/hold',
      await holdBody(app.fixtures.seatNumbers[2], 'No Key'),
    );
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY.KEY_REQUIRED');
  });

  it('two cancellations at once cancel and refund once; the seat sells again at once (947, 954)', async () => {
    const seat = app.fixtures.seatNumbers[2];
    const { bookingId } = await confirmedBooking(app, seat, { fullName: 'Cancel Twice', age: 30 });
    const results = await Promise.all(
      ['a', 'b'].map((k) =>
        app.post(
          `/bookings/${bookingId}/cancel`,
          { reason: 'Plans changed' },
          { ...op, idempotencyKey: `cx-${run}-${k}` },
        ),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([200, 422]);
    const c = await sqlOne<{ n: string }>(
      app,
      'SELECT count(*) AS n FROM cancellations WHERE booking_id = $1',
      [bookingId],
    );
    expect(Number(c.n)).toBe(1);
    // The released seat is free for the next buyer straight away.
    const next = await heldBooking(app, seat, { fullName: 'Next Buyer', age: 28 });
    expect(next.bookingId).toBeTruthy();
  });

  it('a hold that timed out cannot be paid for; its seat is free again (918, 973)', async () => {
    const seat = app.fixtures.seatNumbers[3];
    const { bookingId, key } = await heldBooking(app, seat, { fullName: 'Too Slow', age: 41 });
    await sqlOne(
      app,
      `UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [bookingId],
    );
    const pay = await app.post(
      '/payments/charge',
      { bookingId, method: 'upi', vpa: 'success@ticketly' },
      { idempotencyKey: `late-pay-${key}` },
    );
    expect(pay.status, JSON.stringify(pay.body)).not.toBe(200);
    const b = await sqlOne<{ status: string }>(app, 'SELECT status FROM bookings WHERE id = $1', [
      bookingId,
    ]);
    expect(b.status).not.toBe('confirmed');
    const retake = await heldBooking(app, seat, { fullName: 'On Time', age: 35 });
    expect(retake.bookingId).not.toBe(bookingId);
  });

  it('PNRs and seat assignments stay unique (942, 946, 964, 965)', async () => {
    const dup = await sqlOne<{ n: string }>(
      app,
      `SELECT count(*) AS n FROM (SELECT pnr FROM bookings GROUP BY tenant_id, pnr HAVING count(*) > 1) d`,
    );
    expect(Number(dup.n)).toBe(0);
    // No confirmed booking without a seat, and no seat sold twice on a trip's leg.
    const seatless = await sqlOne<{ n: string }>(
      app,
      `SELECT count(*) AS n FROM bookings b
        WHERE b.trip_id = $1 AND b.status = 'confirmed'
          AND NOT EXISTS (SELECT 1 FROM booking_seats bs WHERE bs.booking_id = b.id)`,
      [app.fixtures.tripId],
    );
    expect(Number(seatless.n)).toBe(0);
    const twice = await sqlOne<{ n: string }>(
      app,
      `SELECT count(*) AS n
         FROM booking_seats a JOIN bookings ba ON ba.id = a.booking_id
         JOIN booking_seats b ON b.trip_id = a.trip_id AND b.seat_number = a.seat_number
                             AND b.booking_id > a.booking_id
         JOIN bookings bb ON bb.id = b.booking_id
        WHERE a.trip_id = $1 AND ba.status = 'confirmed' AND bb.status = 'confirmed'
          AND ba.from_seq < bb.to_seq AND bb.from_seq < ba.to_seq`,
      [app.fixtures.tripId],
    );
    expect(Number(twice.n)).toBe(0);
  });
});
