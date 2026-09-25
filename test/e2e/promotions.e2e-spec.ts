import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Route promotions an operator buys: the price shown is the price charged,
 * only published routes of their own, never twice for the same days (a double
 * click used to be able to charge twice), and a paused promotion can still be
 * cancelled — the list offered it, the API refused it.
 */
describe('route promotions (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let routeId: string;
  const op = { as: 'operator' as const };
  // Calendar days in India (the platform's day boundary), not UTC.
  const day = (n: number) =>
    new Date(Date.now() + 5.5 * 3_600_000 + n * 864e5).toISOString().slice(0, 10);
  // Far ahead, a different window per run, so nothing shows in today's search.
  const base = 400 + (Math.floor(Date.now() / 1000) % 2000);
  let keyN = 0;
  const key = () => `e2e-promo-${Date.now()}-${(keyN += 1)}`;

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
    // The platform's rate card has to exist before anything can be priced.
    const rates = await app.get('/promotions/rates', op);
    if (rates.body.rates.length < 6) {
      const card: [string, boolean, number][] = [
        ['daily', false, 50000],
        ['weekly', false, 300000],
        ['monthly', false, 1000000],
        ['daily', true, 40000],
        ['weekly', true, 250000],
        ['monthly', true, 800000],
      ];
      for (const [billingCycle, isMultiRoute, priceMinor] of card) {
        const r = await app.post(
          '/admin/promotions/rates',
          { billingCycle, isMultiRoute, priceMinor },
          { as: 'platformAdmin' },
        );
        expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
      }
    }
    routeId = (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op)).body.trip.routeId;
  });
  afterAll(async () => {
    // Leave nothing promoted behind for the next run (or a real search).
    for (const id of bought) await app.del(`/promotions/${id}`, op);
    await app.close();
  });

  const bought: string[] = [];
  const buy = async (body: object, headers?: Record<string, string>) => {
    const r = await app.post('/promotions', body, {
      ...(headers ? { headers } : op),
      idempotencyKey: key(),
    });
    if (r.status === 201 && !headers) bought.push(...(r.body.promotionIds as string[]));
    return r;
  };
  const quote = (routeCount: number, startDate: string, endDate: string) =>
    app.get(
      `/promotions/quote?routeCount=${routeCount}&startDate=${startDate}&endDate=${endDate}`,
      op,
    );

  it('quotes exactly what a purchase charges', async () => {
    const q = await quote(1, day(base), day(base + 9));
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body).toMatchObject({ days: 10, breakdown: { months: 0, weeks: 1, days: 3 } });
    expect((await quote(1, day(-1), day(3))).status).toBe(422); // starts in the past
    expect((await quote(1, day(base + 5), day(base))).status).toBe(422); // ends before start
    expect((await quote(0, day(base), day(base))).status).toBe(400);

    const r = await buy({ routeIds: [routeId], startDate: day(base), endDate: day(base + 9) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.totalMinor).toBe(q.body.totalMinor);
    const list = await app.get('/promotions', op);
    const mine = list.body.promotions.find((p: { id: string }) => p.id === r.body.promotionIds[0]);
    expect(mine).toMatchObject({ status: 'active', routeId });
    expect(mine.routeName).toBeTruthy();
  });

  it('never sells the same days twice, even to two requests at once', async () => {
    const body = { routeIds: [routeId], startDate: day(base + 20), endDate: day(base + 22) };
    const [a, b] = await Promise.all([buy(body), buy(body)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const clash = a.status === 409 ? a : b;
    expect(clash.body.detail).toMatch(/already promoted/);
    expect(clash.body.detail).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/); // a name, not an id
    // A purchase needs an Idempotency-Key, so a retried request replays instead.
    expect(
      (
        await app.post(
          '/promotions',
          { routeIds: [routeId], startDate: day(base + 30), endDate: day(base + 30) },
          op,
        )
      ).status,
    ).toBe(400);
  });

  it('only this operator’s published routes can be promoted', async () => {
    const body = { routeIds: [routeId], startDate: day(base + 40), endDate: day(base + 41) };
    expect((await buy(body, otherOperator)).status).toBe(404);
    const copy = await app.post(
      `/master-data/routes/${routeId}/duplicate`,
      { code: `E2EP${Date.now() % 100000}`, name: 'E2E draft copy' },
      op,
    );
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    const draft = await buy({ ...body, routeIds: [copy.body.id] });
    expect(draft.status).toBe(422);
    expect(draft.body.detail).toMatch(/not published/);
    // Leave no stray draft route behind.
    expect(
      (await app.post(`/master-data/routes/${copy.body.id}/archive`, {}, op)).status,
    ).toBeLessThan(300);
  });

  it('a paused promotion can be cancelled, once, by its owner only', async () => {
    const r = await buy({
      routeIds: [routeId],
      startDate: day(base + 50),
      endDate: day(base + 56),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.promotionIds[0];
    expect((await app.post(`/promotions/${id}/pause`, {}, op)).status).toBe(201);
    expect((await app.post(`/promotions/${id}/pause`, {}, op)).status).toBe(422);
    expect((await app.del(`/promotions/${id}`, { headers: otherOperator })).status).toBe(404);
    const cancelled = await app.del(`/promotions/${id}`, op);
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    // It had not started, so every day comes back.
    expect(cancelled.body.adjustedMinor).toBe(r.body.totalMinor);
    expect((await app.del(`/promotions/${id}`, op)).status).toBe(422);
    expect((await app.post(`/promotions/${id}/resume`, {}, op)).status).toBe(422);
    // Its days are free again.
    const again = await buy({
      routeIds: [routeId],
      startDate: day(base + 50),
      endDate: day(base + 56),
    });
    expect(again.status).toBe(201);
  });
  it('a promoted route is shown in a top slot whatever the customer sorts by', async () => {
    // A busy city pair — with a handful of buses every route is "on top" anyway.
    const city = async (slug: string) =>
      (await app.get(`/master-data/cities/by-slug/${slug}`, { headers: {} })).body.id as string;
    const [originCityId, destCityId] = await Promise.all([city('delhi'), city('jaipur')]);
    const search = (sort: string, sortDir: string) =>
      app.post(
        '/search',
        { originCityId, destCityId, journeyDate: day(3), sort, sortDir },
        { headers: {} }, // the public storefront: every operator
      );
    const ours = new Set(
      (await app.get('/master-data/routes?status=published', op)).body.items.map(
        (r: { id: string }) => r.id,
      ),
    );
    const first = await search('departure', 'asc');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const target = first.body.results.find((x: { routeId: string }) => ours.has(x.routeId))
      ?.routeId as string;
    expect(target, 'a bus of ours between Delhi and Jaipur').toBeTruthy();

    const position = async (sort: string, dir: string) => {
      const res = await search(sort, dir);
      const at = res.body.results.findIndex((x: { routeId: string }) => x.routeId === target);
      expect(at, `${sort} ${dir}`).toBeGreaterThanOrEqual(0);
      return { at, promoted: res.body.results[at].isPromoted === true };
    };
    // Orders in which this route is NOT near the top on its own merits.
    const orders: [string, string][] = [];
    for (const sort of ['departure', 'price', 'duration', 'rating']) {
      for (const dir of ['asc', 'desc']) {
        if ((await position(sort, dir)).at >= 3) orders.push([sort, dir]);
      }
    }
    expect(orders.length, 'a sort that puts this route below the top 3').toBeGreaterThan(0);

    const r = await buy({ routeIds: [target], startDate: day(0), endDate: day(0) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    try {
      for (const [sort, dir] of orders) {
        const { at, promoted } = await position(sort, dir);
        expect(at, `${sort} ${dir}`).toBeLessThan(3);
        expect(promoted).toBe(true);
      }
    } finally {
      expect((await app.del(`/promotions/${r.body.promotionIds[0]}`, op)).status).toBe(200);
    }
    expect((await position(...orders[0])).promoted).toBe(false);
  });
});
