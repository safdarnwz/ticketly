import { expect } from 'vitest';

import type { TestApp } from './bootstrap';

type Passenger = { fullName: string; age?: number; gender?: 'male' | 'female' | 'other' };

/** Quote and hold one seat on the fixture trip (awaiting payment). */
export async function heldBooking(
  app: TestApp,
  seat: string,
  passenger: Passenger,
): Promise<{ bookingId: string; pnr: string; key: string }> {
  const f = app.fixtures;
  const quote = await app.post('/pricing/quote', {
    tripId: f.tripId,
    fromStopId: f.fromStopId,
    toStopId: f.toStopId,
    seatType: 'seater',
    seatNumbers: [seat],
  });
  expect(quote.status, JSON.stringify(quote.body)).toBe(200);
  const key = `${seat}-${f.customer.phone}-${Date.now()}`;
  const hold = await app.post(
    '/bookings/hold',
    {
      quoteId: quote.body.quoteId,
      seatNumbers: [seat],
      passengers: [{ seatNumber: seat, ...passenger }],
      contactPhone: f.customer.phone,
    },
    { idempotencyKey: `e2e-hold-${key}` },
  );
  expect(hold.status, JSON.stringify(hold.body)).toBe(201);
  return { bookingId: hold.body.bookingId, pnr: hold.body.pnr, key };
}

/** Hold and pay (test mode) one seat on the fixture trip; returns the confirmed booking. */
export async function confirmedBooking(
  app: TestApp,
  seat: string,
  passenger: Passenger,
): Promise<{ bookingId: string; pnr: string }> {
  const { bookingId, pnr, key } = await heldBooking(app, seat, passenger);
  const pay = await app.post(
    '/payments/charge',
    { bookingId, method: 'upi', vpa: 'success@ticketly' },
    { idempotencyKey: `e2e-pay-${key}` },
  );
  expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  return { bookingId, pnr };
}
