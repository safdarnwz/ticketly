import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { sqlOne } from './support/flows';

/**
 * Pickup / drop point charges (#286, #287): an operator charges extra per seat
 * for boarding at, or getting off at, a particular stop. The charge is part of
 * the taxable fare, never discounted by a coupon, shown with the trip's stops,
 * and copied when the route is duplicated. The demo route is shared with other
 * suites (and may carry demo charges), so the fixture's two stops start at 0
 * and every stop gets its own charges back at the end.
 */
describe('pickup / drop point charges (e2e)', () => {
  let app: TestApp;
  let routeId: string;
  let otherOperator: Record<string, string>;
  let original: { stopId: string; boardChargeMinor: number; dropChargeMinor: number }[];
  let stops: {
    stopId: string;
    name: string;
    sequence: number;
    boardChargeMinor: number;
    dropChargeMinor: number;
  }[];
  const op = { as: 'operator' as const };

  const quote = () =>
    app.post(
      '/pricing/quote',
      {
        tripId: app.fixtures.tripId,
        fromStopId: app.fixtures.fromStopId,
        toStopId: app.fixtures.toStopId,
        seatType: 'seater',
        seatNumbers: [app.fixtures.seatNumbers[0]],
      },
      { as: 'anonymous' },
    );
  const put = (items: object[], opts: object = op) =>
    app.put(`/master-data/routes/${routeId}/point-charges`, { items }, opts);

  beforeAll(async () => {
    app = await bootstrapTestApp();
    routeId = (
      await sqlOne<{ route_id: string }>(app, 'SELECT route_id FROM trips WHERE id = $1', [
        app.fixtures.tripId,
      ])
    ).route_id;
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
    const list = await app.get(`/master-data/routes/${routeId}/point-charges`, op);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    original = list.body.items;
    // The fixture's boarding and dropping stops start without a charge.
    const reset = await put([
      { stopId: app.fixtures.fromStopId, boardChargeMinor: 0, dropChargeMinor: 0 },
      { stopId: app.fixtures.toStopId, boardChargeMinor: 0, dropChargeMinor: 0 },
    ]);
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    stops = reset.body.items;
  });
  afterAll(async () => {
    await put(
      original.map((s) => ({
        stopId: s.stopId,
        boardChargeMinor: s.boardChargeMinor,
        dropChargeMinor: s.dropChargeMinor,
      })),
    );
    await app.close();
  });

  it('lists every stop of the route; others cannot see or change them', async () => {
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(stops[0]).toMatchObject({ boardChargeMinor: 0, dropChargeMinor: 0 });
    expect((await app.get(`/master-data/routes/${routeId}/point-charges`)).status).toBe(403);
    const foreign = await app.get(`/master-data/routes/${routeId}/point-charges`, {
      headers: otherOperator,
    });
    expect(foreign.status).toBe(404);
    const foreignPut = await put([{ stopId: stops[0].stopId, boardChargeMinor: 100 }], {
      headers: otherOperator,
    });
    expect(foreignPut.status).toBe(404);
  });

  it('refuses charges that cannot apply', async () => {
    const first = stops[0];
    const last = stops[stops.length - 1];
    expect((await put([{ stopId: first.stopId, boardChargeMinor: -100 }])).status).toBe(400);
    expect((await put([{ stopId: first.stopId, boardChargeMinor: 100001 }])).status).toBe(400);
    expect((await put([{ stopId: first.stopId, boardChargeMinor: 10.5 }])).status).toBe(400);
    expect((await put([])).status).toBe(400);
    const notOnRoute = await put([
      { stopId: '01a0dd19-0000-7000-8000-000000000000', boardChargeMinor: 100 },
    ]);
    expect(notOnRoute.status).toBe(422);
    expect(notOnRoute.body.detail).toMatch(/not on this route/);
    const boardAtEnd = await put([{ stopId: last.stopId, boardChargeMinor: 100 }]);
    expect(boardAtEnd.status).toBe(422);
    expect(boardAtEnd.body.detail).toMatch(/cannot board/);
    const dropAtStart = await put([{ stopId: first.stopId, dropChargeMinor: 100 }]);
    expect(dropAtStart.status).toBe(422);
    expect(dropAtStart.body.detail).toMatch(/cannot get off/);
    const twice = await put([
      { stopId: first.stopId, boardChargeMinor: 100 },
      { stopId: first.stopId, boardChargeMinor: 200 },
    ]);
    expect(twice.status).toBe(422);
    expect(twice.body.detail).toMatch(/listed twice/);
    // Nothing was saved by the refused calls.
    const after = await app.get(`/master-data/routes/${routeId}/point-charges`, op);
    expect(after.body.items).toEqual(stops);
  });

  it('adds the pickup and drop charges to the fare before GST and shows them on the trip', async () => {
    const before = await quote();
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(before.body.pointCharges).toEqual({ boardMinor: 0, dropMinor: 0 });

    const saved = await put([
      { stopId: app.fixtures.fromStopId, boardChargeMinor: 5000 },
      { stopId: app.fixtures.toStopId, dropChargeMinor: 3000 },
    ]);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const byId = new Map(saved.body.items.map((s: { stopId: string }) => [s.stopId, s]));
    expect(byId.get(app.fixtures.fromStopId)).toMatchObject({
      boardChargeMinor: 5000,
      dropChargeMinor: 0,
    });
    expect(byId.get(app.fixtures.toStopId)).toMatchObject({
      boardChargeMinor: 0,
      dropChargeMinor: 3000,
    });

    const after = await quote();
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.pointCharges).toEqual({ boardMinor: 5000, dropMinor: 3000 });
    const labels = (after.body.perSeat.lines as { label: string }[]).map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Pickup point charge', 'Drop point charge']));
    // ₹80 more before GST: the total grows by ₹80 plus its GST.
    const grew = after.body.totalMinor - before.body.totalMinor;
    expect(grew).toBeGreaterThanOrEqual(8000);
    expect(grew).toBeLessThanOrEqual(8000 * 1.28);

    const trip = await app.get(`/scheduling/trips/${app.fixtures.tripId}`, { as: 'anonymous' });
    expect(trip.status).toBe(200);
    const from = trip.body.stops.find(
      (s: { stopId: string }) => s.stopId === app.fixtures.fromStopId,
    );
    const to = trip.body.stops.find((s: { stopId: string }) => s.stopId === app.fixtures.toStopId);
    expect(from.boardChargeMinor).toBe(5000);
    expect(to.dropChargeMinor).toBe(3000);
  });

  it('a duplicated route starts with the same charges', async () => {
    const code = `E2EPC${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
    const dup = await app.post(
      `/master-data/routes/${routeId}/duplicate`,
      { code, name: `Copy ${code}` },
      op,
    );
    expect(dup.status, JSON.stringify(dup.body)).toBe(201);
    const copy = await app.get(`/master-data/routes/${dup.body.id}/point-charges`, op);
    const c = new Map(copy.body.items.map((s: { stopId: string }) => [s.stopId, s]));
    expect(c.get(app.fixtures.fromStopId)).toMatchObject({ boardChargeMinor: 5000 });
    expect(c.get(app.fixtures.toStopId)).toMatchObject({ dropChargeMinor: 3000 });
    // An archived route's charges cannot change.
    expect(
      (await app.post(`/master-data/routes/${dup.body.id}/archive`, {}, op)).status,
    ).toBeLessThan(300);
    const archived = await app.put(
      `/master-data/routes/${dup.body.id}/point-charges`,
      { items: [{ stopId: app.fixtures.fromStopId, boardChargeMinor: 0 }] },
      op,
    );
    expect(archived.status).toBe(422);
    expect(archived.body.detail).toMatch(/archived/);
  });
});
