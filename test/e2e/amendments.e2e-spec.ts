import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * End-to-end: changes to a confirmed booking — seat change, name correction,
 * reschedule — each one unit of work over seats, passengers, tickets and the
 * amendment audit row. A refused amendment must leave the booking untouched.
 */
describe('booking amendments (e2e)', () => {
  let app: TestApp;
  let bookingId: string;
  const seats = () => app.fixtures.seatNumbers;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const seat = seats()[0];
    const quote = await app.post('/pricing/quote', {
      tripId: app.fixtures.tripId,
      fromStopId: app.fixtures.fromStopId,
      toStopId: app.fixtures.toStopId,
      seatType: 'seater',
      seatNumbers: [seat],
    });
    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: [seat],
        passengers: [{ seatNumber: seat, fullName: 'Amit Kumar', age: 34, gender: 'male' }],
        contactPhone: app.fixtures.customer.phone,
      },
      { idempotencyKey: `e2e-amend-hold-${app.fixtures.customer.phone}` },
    );
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    bookingId = hold.body.bookingId;
    const pay = await app.post(
      '/payments/charge',
      { bookingId, method: 'upi', vpa: 'success@ticketly' },
      { idempotencyKey: `e2e-amend-pay-${app.fixtures.customer.phone}` },
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  });
  afterAll(async () => {
    await app.close();
  });

  const tickets = async () =>
    (await app.get(`/bookings/${bookingId}/tickets`)).body.tickets as { seat: string }[];

  it('moves the passenger and the ticket to a new seat', async () => {
    const res = await app.post(
      `/bookings/${bookingId}/change-seats`,
      { newSeatNumbers: [seats()[1]] },
      { as: 'operator', idempotencyKey: `e2e-amend-seat-${bookingId}` },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.amendmentId).toBeDefined();
    expect((await tickets()).map((t) => t.seat)).toEqual([seats()[1]]);
  });

  it('corrects the passenger name spelling, once', async () => {
    const correct = (fullName: string, key: string) =>
      app.post(
        `/bookings/${bookingId}/correct-name`,
        { seatNumber: seats()[1], fullName },
        { as: 'operator', idempotencyKey: key },
      );
    const first = await correct('Amit Kumaar', `e2e-amend-name-${bookingId}`);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    // A different person is a transfer, not a spelling fix.
    const transfer = await correct('Priya Sharma', `e2e-amend-name2-${bookingId}`);
    expect(transfer.status).toBe(422);
  });

  it('refuses a reschedule that would cost more, and changes nothing', async () => {
    // Same fare + the reschedule fee = money due, which reschedule cannot
    // collect yet (cancel and rebook instead) — so it is refused outright.
    const res = await app.post(
      `/bookings/${bookingId}/reschedule`,
      {
        newTripId: app.fixtures.tripId,
        newFromStopId: app.fixtures.fromStopId,
        newToStopId: app.fixtures.toStopId,
        newSeatNumbers: [seats()[2]],
      },
      { as: 'operator', idempotencyKey: `e2e-amend-resched-${bookingId}` },
    );
    expect(res.status).toBe(422);
    expect(res.body.detail).toContain('cancel and book');
    expect((await tickets()).map((t) => t.seat)).toEqual([seats()[1]]);

    // The seat the booking still holds stays unavailable to others.
    const quote = await app.post('/pricing/quote', {
      tripId: app.fixtures.tripId,
      fromStopId: app.fixtures.fromStopId,
      toStopId: app.fixtures.toStopId,
      seatType: 'seater',
      seatNumbers: [seats()[1]],
    });
    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: [seats()[1]],
        passengers: [{ seatNumber: seats()[1], fullName: 'Next Traveller' }],
        contactPhone: app.fixtures.customer.phone,
      },
      { idempotencyKey: `e2e-amend-rehold-${bookingId}` },
    );
    expect(hold.status).toBe(422);
  });
});
