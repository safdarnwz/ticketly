import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Operator pricing tools.
 *
 * Coupons: what can be saved, how a quote applies one, switching one
 * off, and another operator's coupons staying out of reach. A coupon at 0% /
 * ₹0, above 100% or ending before it starts used to be accepted and then
 * silently never applied.
 */
describe('pricing admin (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  const op = { as: 'operator' as const };
  const future = new Date(Date.now() + 30 * 864e5).toISOString();
  const code = `E2E${Date.now().toString(36).toUpperCase()}`;

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

  const create = (body: object) => app.post('/pricing/coupons', body, op);
  const quote = (couponCode?: string) =>
    app.post(
      '/pricing/quote',
      {
        tripId: app.fixtures.tripId,
        fromStopId: app.fixtures.fromStopId,
        toStopId: app.fixtures.toStopId,
        seatType: 'seater',
        seatNumbers: [app.fixtures.seatNumbers[0]],
        ...(couponCode ? { couponCode } : {}),
      },
      { as: 'anonymous' },
    );
  const issuesOf = (body: { errors?: { issues?: { path: string }[] } }) =>
    (body.errors?.issues ?? []).map((i) => i.path);

  it('refuses a coupon that could never apply', async () => {
    const cases: [object, string][] = [
      [{ code: 'ZERO', kind: 'percent', value: 0 }, 'value'],
      [{ code: 'OVER', kind: 'percent', value: 101 }, 'value'],
      [{ code: 'PAISE', kind: 'flat', value: 50 }, 'value'],
      [{ code: 'has space', kind: 'percent', value: 10 }, 'code'],
      [{ code: 'CAPFLAT', kind: 'flat', value: 5000, maxDiscountMinor: 1000 }, 'maxDiscountMinor'],
      [{ code: 'PAST', kind: 'percent', value: 10, validTo: '2020-01-01T00:00:00Z' }, 'validTo'],
      [
        {
          code: 'BACKWARDS',
          kind: 'percent',
          value: 10,
          validFrom: future,
          validTo: new Date(Date.parse(future) - 864e5).toISOString(),
        },
        'validTo',
      ],
      [{ code: 'NOUSE', kind: 'percent', value: 10, maxRedemptions: 0 }, 'maxRedemptions'],
    ];
    for (const [body, field] of cases) {
      const r = await create(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(issuesOf(r.body)).toContain(field);
    }
    // A customer cannot create one at all.
    expect((await app.post('/pricing/coupons', { code, kind: 'percent', value: 10 })).status).toBe(
      403,
    );
  });

  it('a saved coupon applies to a quote, once per code', async () => {
    const r = await create({
      code: `  ${code.toLowerCase()} `,
      kind: 'percent',
      value: 10,
      validTo: future,
      maxRedemptions: 5,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Same code again (any case) is a clear conflict, not a second row.
    const dup = await create({ code, kind: 'flat', value: 10000 });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toBe('A coupon with this code already exists');

    const list = await app.get('/pricing/coupons', op);
    const saved = list.body.coupons.find((c: { id: string }) => c.id === r.body.id);
    expect(saved).toMatchObject({ code, kind: 'percent', maxRedemptions: 5, isActive: true });

    const plain = await quote();
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    const withCoupon = await quote(code.toLowerCase());
    expect(withCoupon.status, JSON.stringify(withCoupon.body)).toBe(200);
    expect(withCoupon.body.totalMinor).toBeLessThan(plain.body.totalMinor);
    expect((await quote('NO-SUCH-CODE')).status).toBe(422);
  });

  it('a switched-off coupon stops applying, and comes back', async () => {
    const list = await app.get('/pricing/coupons', op);
    const { id } = list.body.coupons.find((c: { code: string }) => c.code === code);
    expect((await app.post(`/pricing/coupons/${id}/disable`, {}, op)).status).toBe(201);
    expect((await quote(code)).status).toBe(422);
    expect((await app.post(`/pricing/coupons/${id}/enable`, {}, op)).status).toBe(201);
    expect((await quote(code)).status).toBe(200);
  });

  it("another operator neither sees nor switches off this operator's coupon", async () => {
    const list = await app.get('/pricing/coupons', op);
    const { id } = list.body.coupons.find((c: { code: string }) => c.code === code);
    const theirs = await app.get('/pricing/coupons', { headers: otherOperator });
    expect(theirs.status).toBe(200);
    expect(theirs.body.coupons.some((c: { id: string }) => c.id === id)).toBe(false);
    expect(
      (await app.post(`/pricing/coupons/${id}/disable`, {}, { headers: otherOperator })).status,
    ).toBe(404);
    expect((await app.get(`/pricing/coupons/${id}/stats`, { headers: otherOperator })).status).toBe(
      404,
    );
    expect((await quote(code)).status).toBe(200);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await app.post(`/pricing/coupons/${unknown}/enable`, {}, op)).status).toBe(404);
  });
  describe('yield policies', () => {
    const ladder = (over: object = {}) => ({
      occupancy: [],
      // Every day ahead counts as "within 365 days", so the step always applies.
      advancePurchase: [{ withinDays: 365, mult: 1.5 }],
      maxMultiplier: 2,
      minMultiplier: 1,
      ...over,
    });
    const policy = (body: object, headers?: Record<string, string>) =>
      app.post('/pricing/policies', body, headers ? { headers } : op);
    const tripRoute = async () => {
      const r = await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.trip.routeId as string;
    };
    const policies = async () =>
      (await app.get('/pricing/policies', op)).body.policies as {
        id: string;
        name: string;
        routeId: string | null;
        isActive: boolean;
      }[];

    it('refuses a ladder that would price seats at nothing or is ambiguous', async () => {
      const routeId = await tripRoute();
      const bad: object[] = [
        {
          routeId,
          name: 'zero',
          ladder: ladder({ advancePurchase: [{ withinDays: 3, mult: 0 }] }),
        },
        { routeId, name: 'floor', ladder: ladder({ minMultiplier: 0 }) },
        {
          routeId,
          name: 'twice',
          ladder: ladder({
            occupancy: [
              { atPct: 80, mult: 1.2 },
              { atPct: 80, mult: 1.4 },
            ],
          }),
        },
        { routeId, name: '', ladder: ladder() },
      ];
      for (const body of bad) expect((await policy(body)).status, JSON.stringify(body)).toBe(400);
      // Another operator's route is not one of ours.
      expect(
        (await policy({ routeId, name: 'theirs', ladder: ladder() }, otherOperator)).status,
      ).toBe(404);
    });

    it('a route policy moves the quote; a newer one replaces it; switching off restores fares', async () => {
      const routeId = await tripRoute();
      const plain = (await quote()).body.totalMinor as number;

      const first = await policy({ routeId, name: 'E2E surge', ladder: ladder() });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const surged = (await quote()).body.totalMinor as number;
      expect(surged).toBeGreaterThan(plain);

      const second = await policy({
        routeId,
        name: 'E2E flat',
        ladder: ladder({ advancePurchase: [] }),
      });
      expect(second.status).toBe(201);
      const list = await policies();
      expect(list.find((p) => p.id === first.body.id)?.isActive).toBe(false);
      expect(list.find((p) => p.id === second.body.id)?.isActive).toBe(true);
      expect(list.filter((p) => p.routeId === routeId && p.isActive)).toHaveLength(1);
      expect((await quote()).body.totalMinor).toBe(plain);

      // Not theirs to switch off; unknown ids are 404 too.
      const path = `/pricing/policies/${second.body.id}/deactivate`;
      expect((await app.post(path, {}, { headers: otherOperator })).status).toBe(404);
      expect(
        (
          await app.post(
            '/pricing/policies/00000000-0000-4000-8000-000000000000/deactivate',
            {},
            op,
          )
        ).status,
      ).toBe(404);
      expect((await app.post(path, {}, op)).status).toBe(201);
      expect((await policies()).some((p) => p.routeId === routeId && p.isActive)).toBe(false);
      expect((await quote()).body.totalMinor).toBe(plain);
    });

    it("one service's own policy wins over its route's; each scope has one active", async () => {
      const trip = (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op)).body.trip;
      const { routeId, serviceId } = trip as { routeId: string; serviceId: string };
      const unknown = '00000000-0000-4000-8000-000000000000';
      expect((await policy({ routeId, serviceId, name: 'both', ladder: ladder() })).status).toBe(
        400,
      );
      expect((await policy({ serviceId: unknown, name: 'nope', ladder: ladder() })).status).toBe(
        404,
      );
      expect(
        (await policy({ serviceId, name: 'theirs', ladder: ladder() }, otherOperator)).status,
      ).toBe(404);

      const plain = (await quote()).body.totalMinor as number;
      const route = await policy({
        routeId,
        name: 'E2E route flat',
        ladder: ladder({ advancePurchase: [] }),
      });
      const svc = await policy({ serviceId, name: 'E2E 21:30 surge', ladder: ladder() });
      expect(svc.status, JSON.stringify(svc.body)).toBe(201);
      try {
        expect((await quote()).body.totalMinor).toBeGreaterThan(plain);
        const list = (await app.get('/pricing/policies', op)).body.policies as {
          id: string;
          serviceId: string | null;
          isActive: boolean;
        }[];
        expect(list.find((p) => p.id === svc.body.id)).toMatchObject({ serviceId, isActive: true });
        expect(list.find((p) => p.id === route.body.id)?.isActive).toBe(true);
      } finally {
        await app.post(`/pricing/policies/${svc.body.id}/deactivate`, {}, op);
        await app.post(`/pricing/policies/${route.body.id}/deactivate`, {}, op);
      }
      expect((await quote()).body.totalMinor).toBe(plain);
    });
  });
  describe('fare plans', () => {
    it("a plan needs a fare to go live, and another operator's plan is out of reach", async () => {
      const routeId = (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op)).body.trip
        .routeId as string;
      // Dated years ahead so activating it never changes today's prices.
      const plan = await app.post(
        '/pricing/fare-plans',
        { routeId, name: 'E2E future', effectiveFrom: '2031-01-01', effectiveTo: '2031-12-31' },
        op,
      );
      expect(plan.status, JSON.stringify(plan.body)).toBe(201);
      const id = plan.body.id as string;

      const activate = (planId: string, headers?: Record<string, string>) =>
        app.post(`/pricing/fare-plans/${planId}/activate`, {}, headers ? { headers } : op);
      const empty = await activate(id);
      expect(empty.status).toBe(422);
      expect(empty.body.detail).toMatch(/Add a fare/);

      const rule = (body: object, headers?: Record<string, string>) =>
        app.post('/pricing/fare-plans/rules', body, headers ? { headers } : op);
      expect(
        (await rule({ farePlanId: id, seatType: 'seater', baseFareMinor: 50000 }, otherOperator))
          .status,
      ).toBe(404);
      expect((await rule({ farePlanId: id, seatType: 'seater', baseFareMinor: 0 })).status).toBe(
        400,
      );
      expect(
        (await rule({ farePlanId: id, seatType: 'seater', baseFareMinor: 50000 })).status,
      ).toBe(201);
      expect((await activate(id, otherOperator)).status).toBe(404);
      expect((await activate(id)).status).toBe(201);

      // Seat prices: at least ₹1, only on our own plans, and removing twice is a 404.
      const seat = (fareMinor: number, headers?: Record<string, string>) =>
        app.post(
          `/pricing/fare-plans/${id}/seat-overrides`,
          { seatNumber: '1', fareMinor },
          headers ? { headers } : op,
        );
      expect((await seat(0)).status).toBe(400);
      expect((await seat(60000, otherOperator)).status).toBe(404);
      expect((await seat(60000)).status).toBe(201);
      const overrides = await app.get(`/pricing/fare-plans/${id}/seat-overrides`, op);
      const overrideId = overrides.body.items[0].id as string;
      const remove = () => app.del(`/pricing/fare-plans/seat-overrides/${overrideId}`, op);
      expect((await remove()).status).toBe(200);
      expect((await remove()).status).toBe(404);

      // A plan on another operator's route.
      expect(
        (
          await app.post(
            '/pricing/fare-plans',
            { routeId, name: 'Not ours' },
            { headers: otherOperator },
          )
        ).status,
      ).toBe(404);
    });
  });

  it('concessions: age bands that make sense against the passenger policy', async () => {
    const op = { as: 'operator' as const };
    const put = (body: object) => app.put('/concessions/rules', body, op);
    expect((await put({ category: 'child', discountPct: 25, maxAge: 18 })).status).toBe(422);
    expect((await put({ category: 'senior', discountPct: 10 })).status).toBe(422);
    expect((await put({ category: 'student', discountPct: 0 })).status).toBe(422);
    expect(
      (await put({ category: 'student', discountPct: 10, validTo: '2020-01-01' })).status,
    ).toBe(422);
    expect((await put({ category: 'child', discountPct: 25, minAge: 5, maxAge: 12 })).status).toBe(
      200,
    );
    const policy = (await app.get('/concessions', op)).body.policy;
    expect((await app.put('/concessions/policy', { ...policy, adultAge: 12 }, op)).status).toBe(
      422,
    );
    expect(
      (
        await app.put(
          '/concessions/booking-window',
          { maxAdvanceDays: 0, minMinutesBeforeDeparture: 0 },
          op,
        )
      ).status,
    ).toBe(400);
    const got = (await app.get('/concessions', op)).body.rules.find(
      (r: { category: string }) => r.category === 'child',
    );
    expect(got).toMatchObject({ discountPct: 25, maxAge: 12 });
    // Leave the operator as it was.
    expect(
      (await put({ category: 'child', discountPct: 25, minAge: 5, maxAge: 12, active: false }))
        .status,
    ).toBe(200);
  });

  it('route rules and one-trip fare changes: this operator only, upcoming trips only', async () => {
    const op = { as: 'operator' as const };
    const f = app.fixtures;
    const routeId = (await app.get(`/bookings/trips/${f.tripId}/chart`, op)).body.trip
      .routeId as string;
    const nobody = '00000000-0000-4000-8000-000000000000';
    const put = (id: string, body: object) => app.put(`/pricing/routes/${id}/rules`, body, op);
    const none = { floorMinor: null, ceilingMinor: null, peakWindows: [] };
    expect((await put(nobody, none)).status).toBe(404); // was a 409 "record in use"
    expect((await put(routeId, { ...none, floorMinor: 90_000, ceilingMinor: 50_000 })).status).toBe(
      400,
    );
    const peak = [{ startMinute: 1080, endMinute: 1320, pct: 10, label: 'Evening' }];
    expect(
      (await put(routeId, { floorMinor: 10_000, ceilingMinor: 500_000, peakWindows: peak })).status,
    ).toBe(200);
    expect((await app.get(`/pricing/routes/${routeId}/rules`, op)).body).toMatchObject({
      floorMinor: 10_000,
      peakWindows: [{ pct: 10, label: 'Evening' }],
    });

    const adj = (id: string, body: object) => app.put(`/pricing/trips/${id}/adjustment`, body, op);
    expect((await adj(nobody, { pct: 10, reason: 'Festival rush' })).status).toBe(404);
    expect((await adj(f.tripId, { pct: 10 })).status).toBe(400); // a reason is needed
    expect((await adj(f.tripId, { pct: 10, reason: 'Festival rush' })).status).toBe(200);
    expect((await app.get(`/pricing/trips/${f.tripId}/adjustment`, op)).body).toMatchObject({
      pct: 10,
    });
    expect((await adj(f.tripId, { pct: null })).status).toBe(200);
    expect((await put(routeId, none)).status).toBe(200);
  });
});
