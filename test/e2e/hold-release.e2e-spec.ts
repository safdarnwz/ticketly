import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, heldBooking } from './support/flows';

/**
 * A live hold takes its seat off the seat map for everyone; the holder can let
 * it go early (going back to change seats) and nobody else can.
 */
describe('hold release (e2e)', () => {
  let app: TestApp;
  const anon = { as: 'anonymous' as const };

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const isFree = async (seat: string) => {
    const f = app.fixtures;
    const r = await app.get(
      `/scheduling/trips/${f.tripId}/availability?from=${f.fromStopId}&to=${f.toStopId}`,
      anon,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cell = r.body.seats.find((s: { seatNumber: string }) => s.seatNumber === seat);
    expect(cell, `seat ${seat} on the map`).toBeDefined();
    return cell.available as boolean;
  };
  const release = (bookingId: string, body: object, as: 'anonymous' | 'customer' = 'anonymous') =>
    app.post(`/bookings/${bookingId}/release-hold`, body, as === 'anonymous' ? anon : {});

  it('a held seat is not free; only its holder can release it, once', async () => {
    const seat = app.fixtures.seatNumbers[0];
    expect(await isFree(seat)).toBe(true);
    const { bookingId } = await heldBooking(app, seat, { fullName: 'Hold Holder', age: 30 });
    expect(await isFree(seat)).toBe(false);

    // No proof at all, a malformed mobile, someone else's mobile.
    expect((await release(bookingId, {})).status).toBe(400);
    expect((await release(bookingId, { mobile: '12345' })).status).toBe(400);
    const wrong = await release(bookingId, { mobile: '9000000000' });
    expect(wrong.status).toBe(200);
    expect(wrong.body.released).toBe(false);
    expect(await isFree(seat)).toBe(false);

    // The booking's own mobile, in any format.
    const phone = app.fixtures.customer.phone;
    const ok = await release(bookingId, { mobile: `+91 ${phone.slice(-10)}` });
    expect(ok.body.released).toBe(true);
    expect(await isFree(seat)).toBe(true);
    // Idempotent: nothing left to release.
    expect((await release(bookingId, { mobile: phone })).body.released).toBe(false);

    // The released seat can be held again straight away.
    await heldBooking(app, seat, { fullName: 'Second Try', age: 30 });
    expect(await isFree(seat)).toBe(false);
  });

  it('the signed-in customer releases their own hold without a mobile', async () => {
    const seat = app.fixtures.seatNumbers[1];
    const { bookingId } = await heldBooking(app, seat, { fullName: 'Signed In', age: 41 });
    const r = await release(bookingId, {}, 'customer');
    expect(r.status).toBe(200);
    expect(r.body.released).toBe(true);
    expect(await isFree(seat)).toBe(true);
  });

  it('a paid booking is never released', async () => {
    const seat = app.fixtures.seatNumbers[2];
    const { bookingId } = await confirmedBooking(app, seat, { fullName: 'Paid Up', age: 52 });
    const r = await release(bookingId, { mobile: app.fixtures.customer.phone });
    expect(r.body.released).toBe(false);
    expect(await isFree(seat)).toBe(false);
    const staff = await app.get(`/bookings/${bookingId}/tickets`, { as: 'operator' });
    expect(staff.status).toBe(200);
  });

  it('an unknown booking id releases nothing', async () => {
    const r = await release('00000000-0000-4000-8000-000000000000', {
      mobile: app.fixtures.customer.phone,
    });
    expect(r.status).toBe(200);
    expect(r.body.released).toBe(false);
  });
});
