import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * End-to-end: changes to a confirmed booking — seat change, name correction,
 * reschedule — each one unit of work over seats, passengers, tickets and the
 * amendment audit row. A reschedule that costs more moves only once paid.
 */
describe('booking amendments (e2e)', () => {
  let app: TestApp;
  let bookingId: string;
  const seats = () => app.fixtures.seatNumbers;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    ({ bookingId } = await confirmedBooking(app, seats()[0], {
      fullName: 'Amit Kumar',
      age: 34,
      gender: 'male',
    }));
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

  it('a reschedule that costs more is paid for first, then the booking moves', async () => {
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
    // Same fare + the reschedule fee: money is due, so nothing moves yet.
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('payment_required');
    expect(res.body.amountDueMinor).toBeGreaterThan(0);
    expect(res.body.payment.amountMinor).toBe(res.body.amountDueMinor);
    expect((await tickets()).map((t) => t.seat)).toEqual([seats()[1]]);

    const pay = (key: string) =>
      app.post(
        `/payments/intents/${res.body.payment.intentId}/charge-test`,
        { method: 'upi', vpa: 'success@ticketly' },
        { as: 'anonymous', idempotencyKey: key },
      );
    const paid = await pay(`e2e-amend-pay-${bookingId}`);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.status).toBe('captured');
    expect((await tickets()).map((t) => t.seat)).toEqual([seats()[2]]);

    // Paying again changes nothing.
    const again = await pay(`e2e-amend-pay2-${bookingId}`);
    expect(again.body.status).toBe('already_captured');

    // The seat given up can be sold to someone else.
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
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
  });
});
