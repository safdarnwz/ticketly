import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, departingSoon, type TripLeg } from './support/flows';

/**
 * Reviews: only the traveller's own account, only after the bus has left —
 * a confirmed booking for next week could be reviewed, and staff could review
 * a guest booking of their own bus. The operator answers reviews publicly and
 * can report an abusive one, but cannot hide it.
 */
describe('reviews (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  const op = { as: 'operator' as const };
  let leg: TripLeg;
  let routeId: string;
  let upcoming: { bookingId: string };
  let travelled: { bookingId: string; pnr: string };

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
    const f = app.fixtures;
    routeId = (await app.get(`/scheduling/trips/${f.tripId}`, op)).body.trip.routeId;
    // A spare open trip of the same route, which this test lets "depart".
    let spare: { id: string } | undefined;
    // Latest first: the trip-ops test takes the earliest spare trip.
    for (let d = 28; d >= 2 && !spare; d -= 1) {
      const day = new Date(Date.parse(f.journeyDate) + d * 864e5).toISOString().slice(0, 10);
      const list = await app.get(`/scheduling/trips?date=${day}`, op);
      spare = list.body.items.find(
        (t: {
          id: string;
          status: string;
          routeId: string;
          bookedSeats: number;
          totalSeats: number;
        }) =>
          t.id !== f.tripId &&
          t.status === 'open' &&
          t.routeId === routeId &&
          t.bookedSeats < t.totalSeats - 4,
      );
    }
    expect(spare, 'an open trip of the fixture route with free seats').toBeDefined();
    const chart = (await app.get(`/bookings/trips/${spare!.id}/chart`, op)).body;
    leg = {
      tripId: spare!.id,
      fromStopId: chart.stops[0].stopId,
      toStopId: chart.stops[chart.stops.length - 1].stopId,
    };
    const seat = chart.seats.find(
      (s: { blocked: boolean; occupants: unknown[] }) => !s.blocked && s.occupants.length === 0,
    ).seatNumber as string;
    travelled = await confirmedBooking(app, seat, { fullName: 'Happy Traveller', age: 29 }, leg);
    upcoming = await confirmedBooking(app, f.seatNumbers[2], {
      fullName: 'Soon Traveller',
      age: 31,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const review = (bookingId: string, body: object = {}, opts: object = {}) =>
    app.post(
      '/reviews',
      { bookingId, rating: 4, title: 'Good', ...body },
      {
        idempotencyKey: `e2e-review-${bookingId}-${Date.now()}`,
        ...opts,
      },
    );

  it('only the traveller, and only after the bus has left', async () => {
    const early = await review(upcoming.bookingId);
    expect(early.status).toBe(422);
    expect(early.body.detail).toMatch(/once the bus has left/);

    await departingSoon(app, leg.tripId);
    expect(
      (await app.post(`/crew/trips/${leg.tripId}/status`, { status: 'departed' }, op)).status,
    ).toBe(201);

    const staff = await review(travelled.bookingId, {}, { as: 'operator' });
    expect(staff.status).toBe(403);
    expect((await review(travelled.bookingId, { rating: 6 })).status).toBe(400);

    const ok = await review(travelled.bookingId, { rating: 2, body: 'AC did not work' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const again = await review(travelled.bookingId, { rating: 5 });
    expect(again.status).toBe(409);
  });

  it('the operator sees it, answers publicly and can report it — not hide it', async () => {
    const list = await app.get(`/reviews?filter=unanswered&routeId=${routeId}`, op);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const mine = list.body.items.find((r: { pnr: string }) => r.pnr === travelled.pnr);
    expect(mine).toMatchObject({ rating: 2, body: 'AC did not work', reply: null });
    expect(list.body.summary.unanswered).toBeGreaterThanOrEqual(1);
    expect(list.body.summary.counts['2']).toBeGreaterThanOrEqual(1);

    const reply = (text: string, headers?: Record<string, string>) =>
      app.put(`/reviews/${mine.id}/reply`, { reply: text }, headers ? { headers } : op);
    expect((await reply('x'.repeat(1001))).status).toBe(400);
    expect((await reply('Sorry — fixed', otherOperator)).status).toBe(404);
    expect((await reply('  Sorry about the AC — the bus has been serviced.  ')).status).toBe(200);

    const pub = await app.get(`/routes/${routeId}/reviews?limit=100`, { as: 'anonymous' });
    const shown = pub.body.reviews.find((r: { id: string }) => r.id === mine.id);
    expect(shown.reply).toBe('Sorry about the AC — the bus has been serviced.');

    const report = (body: object, headers?: Record<string, string>) =>
      app.post(`/reviews/${mine.id}/report`, body, headers ? { headers } : op);
    expect((await report({ reason: 'because' })).status).toBe(400);
    expect((await report({ reason: 'abusive' }, otherOperator)).status).toBe(404);
    expect((await report({ reason: 'abusive', note: 'insults the driver' })).status).toBe(200);
    expect((await report({ reason: 'spam' })).status).toBe(409);
    // Reported, still published: the platform decides.
    const still = await app.get(`/routes/${routeId}/reviews?limit=100`, { as: 'anonymous' });
    expect(still.body.reviews.some((r: { id: string }) => r.id === mine.id)).toBe(true);
    const reported = await app.get('/reviews?filter=reported', op);
    expect(reported.body.items.find((r: { id: string }) => r.id === mine.id)?.reportReason).toBe(
      'abusive: insults the driver',
    );

    // An empty reply takes it down again.
    expect((await reply('')).status).toBe(200);
    const after = await app.get(`/reviews?filter=unanswered&routeId=${routeId}`, op);
    expect(after.body.items.some((r: { id: string }) => r.id === mine.id)).toBe(true);
    expect(
      (await app.get('/reviews', { headers: otherOperator })).body.items.some(
        (r: { id: string }) => r.id === mine.id,
      ),
    ).toBe(false);
  });
});
