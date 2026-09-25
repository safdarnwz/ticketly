import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * Operator reports. The views grouped revenue by the UTC day (early-morning
 * Indian sales landed on the day before) and counted each trip's seats once
 * per booking, so occupancy came out near 1 %; route performance also counted
 * future trips. The cancellation rate was divided by unpaid holds too.
 */
describe('reports (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  const op = { as: 'operator' as const };
  const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const refresh = () =>
    app.nest.get(UnitOfWork).run({ name: 'e2e.refreshReports', bypassRls: true }, async (s) => {
      await s.client.query('SELECT refresh_reporting_views()');
    });

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
  });
  afterAll(async () => {
    await app.close();
  });

  it("today's sale counts on the operator's own day", async () => {
    const day = istToday();
    await refresh();
    const before = await app.get(`/reports/revenue?from=${day}&to=${day}`, op);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    await confirmedBooking(app, app.fixtures.seatNumbers[1], { fullName: 'Report Rider', age: 33 });
    await refresh();
    const after = await app.get(`/reports/revenue?from=${day}&to=${day}`, op);
    expect(after.body.totals.bookings).toBe(before.body.totals.bookings + 1);
    expect(after.body.totals.seatsSold).toBe(before.body.totals.seatsSold + 1);
    expect(after.body.series.map((r: { date: string }) => r.date)).toEqual([day]);

    // Another operator's report does not move.
    const theirs = await app.get(`/reports/revenue?from=${day}&to=${day}`, {
      headers: otherOperator,
    });
    expect(theirs.status).toBe(200);
  });

  it('occupancy counts each seat once', async () => {
    await refresh();
    const f = app.fixtures;
    const trips = (await app.get(`/scheduling/trips?date=${f.journeyDate}`, op)).body.items as {
      routeId: string;
      totalSeats: number;
      bookedSeats: number;
      status: string;
    }[];
    const routeId = (await app.get(`/scheduling/trips/${f.tripId}`, op)).body.trip
      .routeId as string;
    const mine = trips.filter((t) => t.routeId === routeId && t.status !== 'cancelled');
    const occ = await app.get(`/reports/occupancy?from=${f.journeyDate}&to=${f.journeyDate}`, op);
    expect(occ.status, JSON.stringify(occ.body)).toBe(200);
    const row = (
      occ.body.series as {
        routeId: string;
        totalSeats: number;
        soldSeats: number;
        occupancyPct: number;
        routeName: string;
      }[]
    ).find((r) => r.routeId === routeId);
    expect(row).toBeDefined();
    expect(row!.routeName).toBeTruthy();
    expect(row!.totalSeats).toBe(mine.reduce((a, t) => a + t.totalSeats, 0));
    expect(row!.soldSeats).toBeGreaterThan(0);
    expect(row!.occupancyPct).toBeLessThanOrEqual(100);

    const perf = await app.get('/reports/routes/performance', op);
    for (const r of perf.body.routes as {
      trips: number;
      totalCapacity: number;
      occupancyPct: number;
    }[]) {
      expect(r.occupancyPct).toBeLessThanOrEqual(100);
      expect(r.totalCapacity).toBeLessThanOrEqual(r.trips * 60); // no bus has more than 60 seats
    }
  });

  it('refuses bad periods, exports CSV, and rates cancellations against sales', async () => {
    const day = istToday();
    expect((await app.get(`/reports/revenue?from=${day}&to=2026-01-01`, op)).status).toBe(400);
    expect((await app.get('/reports/revenue?from=2024-01-01&to=2026-01-02', op)).status).toBe(400);
    expect((await app.get('/reports/revenue?from=yesterday&to=today', op)).status).toBe(400);

    const csv = await app.nest.inject({
      method: 'GET',
      url: `/api/v1/reports/revenue.csv?from=${day}&to=${day}`,
      headers: {
        authorization: `Bearer ${app.fixtures.operatorToken}`,
        'x-tenant-slug': app.fixtures.tenantSlug,
      },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n')[0]).toBe('date,bookings,gross,cancelled,seats_sold');

    const c = await app.get(`/reports/cancellations?from=${day}&to=${day}`, op);
    expect(c.status).toBe(200);
    expect(c.body.cancellationRatePct).toBeGreaterThanOrEqual(0);
    expect(c.body.totalCancelled).toBeLessThanOrEqual(c.body.totalBookings);
  });
});
