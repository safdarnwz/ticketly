import { UnitOfWork } from '@database';
import { createContext, runAsTenant, runWithContext, type TenantId } from '@kernel';
import { expect } from 'vitest';

import type { TestApp } from './bootstrap';

type Passenger = { fullName: string; age?: number; gender?: 'male' | 'female' | 'other' };
/** Another trip than the fixture's (default: the fixture trip and its stops). */
export type TripLeg = { tripId: string; fromStopId: string; toStopId: string };

/** Quote and hold one seat on the fixture trip (awaiting payment). */
export async function heldBooking(
  app: TestApp,
  seat: string,
  passenger: Passenger,
  leg?: TripLeg,
): Promise<{ bookingId: string; pnr: string; key: string }> {
  const f = app.fixtures;
  const quote = await app.post('/pricing/quote', {
    tripId: leg?.tripId ?? f.tripId,
    fromStopId: leg?.fromStopId ?? f.fromStopId,
    toStopId: leg?.toStopId ?? f.toStopId,
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
  leg?: TripLeg,
): Promise<{ bookingId: string; pnr: string }> {
  const { bookingId, pnr, key } = await heldBooking(app, seat, passenger, leg);
  const pay = await app.post(
    '/payments/charge',
    { bookingId, method: 'upi', vpa: 'success@ticketly' },
    { idempotencyKey: `e2e-pay-${key}` },
  );
  expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  return { bookingId, pnr };
}

/** Run one SQL statement as the demo operator (tests only) and return its first row. */
export async function sqlOne<T>(app: TestApp, sql: string, params: unknown[] = []): Promise<T> {
  return runWithContext(createContext({ actorType: 'system' }), () =>
    runAsTenant(app.fixtures.tenantId as TenantId, () =>
      app.nest.get(UnitOfWork).run({ name: 'e2e.sql' }, async (s) => {
        const r = await s.client.query(sql, params);
        return r.rows[0] as T;
      }),
    ),
  );
}

/**
 * Bring a test trip's departure to 30 minutes from now (arrival moves with it), so
 * it may be marked departed — a bus can only be marked departed near its time.
 */
export async function departingSoon(app: TestApp, tripId: string): Promise<void> {
  await sqlOne(
    app,
    `UPDATE trips SET arrives_at = arrives_at - (departs_at - (now() + interval '30 minutes')),
                      departs_at = now() + interval '30 minutes'
      WHERE id = $1`,
    [tripId],
  );
}
