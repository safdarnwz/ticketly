import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * "Manage booking" on the customer site: the customer who booked (signed in)
 * or anyone with the booking mobile sees the booking and changes it — seats,
 * name spelling, another date — with the same rules staff work under. Anyone
 * else gets the same 404 as an unknown booking.
 */
describe('customer manage booking (e2e)', () => {
  let app: TestApp;
  let bookingId: string;
  const seats = () => app.fixtures.seatNumbers;
  const guest = { as: 'anonymous' as const };
  const mobile = () => app.fixtures.customer.phone;
  const wrong = '9000000001';
  const unknownId = '00000000-0000-4000-8000-000000000000';
  let n = 0;
  const key = () => `e2e-cm-${Date.now()}-${++n}`;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    ({ bookingId } = await confirmedBooking(app, seats()[0], {
      fullName: 'Neha Verma',
      age: 31,
      gender: 'female',
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  const manage = (qs = '', who: object = guest) =>
    app.get(`/bookings/${bookingId}/manage${qs}`, who);

  it('shows the booking to its customer, to the booking mobile and to the operator only', async () => {
    const mine = await manage('', {});
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body).toMatchObject({
      id: bookingId,
      status: 'confirmed',
      tripId: app.fixtures.tripId,
      fromStopId: app.fixtures.fromStopId,
      toStopId: app.fixtures.toStopId,
      operatorName: expect.any(String),
    });
    expect(mine.body.passengers).toEqual([
      expect.objectContaining({
        seatNumber: seats()[0],
        fullName: 'Neha Verma',
        ticketStatus: 'valid',
      }),
    ]);
    expect((await manage(`?mobile=${mobile()}`)).status).toBe(200);
    expect((await manage(`?mobile=+91 ${mobile()}`)).status).toBe(200); // any spelling of the number
    expect((await manage('', { as: 'operator' })).status).toBe(200);

    expect((await manage()).status).toBe(404);
    expect((await manage(`?mobile=${wrong}`)).status).toBe(404);
    expect((await app.get(`/bookings/${unknownId}/manage?mobile=${mobile()}`, guest)).status).toBe(
      404,
    );
  });

  it('changes seats and fixes a name spelling with the booking mobile', async () => {
    const changeSeats = (m: string) =>
      app.post(
        `/bookings/${bookingId}/change-seats`,
        { newSeatNumbers: [seats()[1]], mobile: m },
        { ...guest, idempotencyKey: key() },
      );
    expect((await changeSeats(wrong)).status).toBe(404);
    const moved = await changeSeats(mobile());
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    const rename = (fullName: string) =>
      app.post(
        `/bookings/${bookingId}/correct-name`,
        { seatNumber: seats()[1], fullName, mobile: mobile() },
        { ...guest, idempotencyKey: key() },
      );
    expect((await rename('Neha Varma')).status).toBe(200);
    expect((await rename('Rahul Singh')).status).toBe(422); // another person, not a spelling fix
    const now = await manage(`?mobile=${mobile()}`);
    expect(now.body.passengers).toEqual([
      expect.objectContaining({ seatNumber: seats()[1], fullName: 'Neha Varma' }),
    ]);
  });

  it('lists buses for another date, prices the change, then moves once paid', async () => {
    const options = (qs: string) =>
      app.get(`/bookings/${bookingId}/reschedule-options?${qs}`, guest);
    expect((await options(`date=26-09-2026&mobile=${mobile()}`)).status).toBe(400);
    expect((await options(`date=${app.fixtures.journeyDate}&mobile=${wrong}`)).status).toBe(404);
    const day = await options(`date=${app.fixtures.journeyDate}&mobile=${mobile()}`);
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    expect(day.body).toMatchObject({ seatsNeeded: 1, fromStopId: app.fixtures.fromStopId });
    for (const t of day.body.trips as { tripId: string; freeSeats: number }[]) {
      expect(t.tripId).not.toBe(app.fixtures.tripId); // not the bus it is already on
      expect(t.freeSeats).toBeGreaterThanOrEqual(0);
    }

    const target = {
      newTripId: app.fixtures.tripId,
      newFromStopId: app.fixtures.fromStopId,
      newToStopId: app.fixtures.toStopId,
    };
    const quote = await app.get(
      `/bookings/${bookingId}/reschedule-quote?newTripId=${target.newTripId}&newFromStopId=${target.newFromStopId}&newToStopId=${target.newToStopId}&seats=${seats()[2]}&mobile=${mobile()}`,
      guest,
    );
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(quote.body.status).toBe('quote');
    expect(quote.body.amountDueMinor).toBeGreaterThan(0); // the reschedule fee
    expect((await manage(`?mobile=${mobile()}`)).body.passengers[0].seatNumber).toBe(seats()[1]);

    const move = await app.post(
      `/bookings/${bookingId}/reschedule`,
      { ...target, newSeatNumbers: [seats()[2]], mobile: mobile() },
      { ...guest, idempotencyKey: key() },
    );
    expect(move.status, JSON.stringify(move.body)).toBe(200);
    expect(move.body.status).toBe('payment_required');
    expect(move.body.amountDueMinor).toBe(quote.body.amountDueMinor);
    const paid = await app.post(
      `/payments/intents/${move.body.payment.intentId}/charge-test`,
      { method: 'upi', vpa: 'success@ticketly' },
      { ...guest, idempotencyKey: key() },
    );
    expect(paid.body.status).toBe('captured');
    expect((await manage(`?mobile=${mobile()}`)).body.passengers[0].seatNumber).toBe(seats()[2]);
  });

  it('a cancelled booking cannot be changed', async () => {
    const cancel = await app.post(
      `/bookings/${bookingId}/self-cancel`,
      { mobile: mobile(), reason: 'Plans changed' },
      { ...guest, idempotencyKey: key() },
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(
      (
        await app.get(
          `/bookings/${bookingId}/reschedule-options?date=${app.fixtures.journeyDate}&mobile=${mobile()}`,
          guest,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await app.post(
          `/bookings/${bookingId}/change-seats`,
          { newSeatNumbers: [seats()[3]], mobile: mobile() },
          { ...guest, idempotencyKey: key() },
        )
      ).status,
    ).toBe(422);
    expect((await manage(`?mobile=${mobile()}`)).body.status).toBe('cancelled');
  });
});
