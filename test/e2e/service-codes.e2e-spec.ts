import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { sqlOne } from './support/flows';

/**
 * A service is known by its route and time — DEL-JAI-1500 — whichever bus
 * runs it on a day. Two of an operator's services leaving together are -A and
 * -B. Codes are per operator: another operator can run its own DEL-JAI-1500.
 */
describe('service codes: route + time, -A/-B when two leave together (e2e)', () => {
  let app: TestApp;
  const op = { as: 'operator' as const };
  let other: Record<string, string>;
  let route: { id: string; vehicleTypeId: string; origin: string; dest: string };
  let theirs: { routeId: string; vehicleTypeId: string };
  const made: { id: string; headers?: Record<string, string> }[] = [];
  let key = 0;

  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const base = (m: number) => `${route.origin}-${route.dest}-${hhmm(m).replace(':', '')}`;
  const body = (m: number, extra: object = {}) => ({
    routeId: route.id,
    vehicleTypeId: route.vehicleTypeId,
    startTime: hhmm(m),
    recurrence: { frequency: 'daily', startDate: day(40), endDate: day(60) },
    ...extra,
  });
  const create = async (m: number, extra: object = {}, headers?: Record<string, string>) => {
    const res = await app.post(
      '/scheduling/services',
      headers ? { ...body(m), ...extra } : body(m, extra),
      headers
        ? { headers: { ...headers, 'idempotency-key': `e2e-sc-${Date.now()}-${key++}` } }
        : { ...op, idempotencyKey: `e2e-sc-${Date.now()}-${key++}` },
    );
    if (res.status === 201) made.push({ id: res.body.id, headers });
    return res;
  };
  const codes = async (headers?: Record<string, string>) =>
    (
      (await app.get('/scheduling/services', headers ? { headers } : op)).body.services as {
        id: string;
        code: string;
      }[]
    ).reduce<Record<string, string>>((acc, s) => ({ ...acc, [s.id]: s.code }), {});
  /** A departure minute at which neither operator has a service yet. */
  const freeMinute = async () => {
    const [ours, their] = [Object.values(await codes()), Object.values(await codes(other))];
    for (;;) {
      const m = Math.floor(Math.random() * 1440);
      if (![...ours, ...their].some((c) => c.startsWith(base(m)))) return m;
    }
  };

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const trip = (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op)).body.trip;
    const svc = (await app.get('/scheduling/services', op)).body.services.find(
      (s: { id: string }) => s.id === trip.serviceId,
    );
    const cities = await sqlOne<{ origin: string; dest: string }>(
      app,
      `SELECT oc.code AS origin, dc.code AS dest FROM routes r
         JOIN cities oc ON oc.id = r.origin_city_id JOIN cities dc ON dc.id = r.dest_city_id
        WHERE r.id = $1`,
      [trip.routeId],
    );
    route = { id: trip.routeId, vehicleTypeId: svc.vehicleTypeId, ...cities };
    expect(route.origin).toMatch(/^[A-Z][A-Z0-9]{2}$/);

    const login = await app.post(
      '/auth/login',
      { identifier: 'admin@maharaja-yatra.example', password: 'pass@123' },
      { headers: { 'x-tenant-slug': 'maharaja-yatra', 'x-debug-surface': 'tenantAdmin' } },
    );
    expect(login.status).toBe(200);
    other = {
      authorization: `Bearer ${login.body.accessToken}`,
      'x-tenant-slug': 'maharaja-yatra',
    };
    const routes = (await app.get('/master-data/routes?status=published', { headers: other })).body
      .items;
    const types = (await app.get('/master-data/vehicle-types', { headers: other })).body.items;
    theirs = { routeId: routes[0].id, vehicleTypeId: types[0].id };
  });
  afterAll(async () => {
    for (const s of made.reverse())
      await app.del(`/scheduling/services/${s.id}`, s.headers ? { headers: s.headers } : op);
    await app.close();
  });

  it('named from the route and the 24-hour time when no code is given', async () => {
    const m = await freeMinute();
    const res = await create(m);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.code).toBe(base(m));
    const detail = (await app.get('/scheduling/services', op)).body.services.find(
      (s: { id: string }) => s.id === res.body.id,
    );
    expect(detail.code).toBe(base(m));
  });

  it('a second at the same time: the first becomes -A (noted in its history), the new one -B; then -C', async () => {
    const m = await freeMinute();
    const first = await create(m);
    expect(first.body.code).toBe(base(m));
    const second = await create(m);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body.code).toBe(`${base(m)}-B`);
    const all = await codes();
    expect(all[first.body.id]).toBe(`${base(m)}-A`);
    const history = (await app.get(`/scheduling/services/${first.body.id}/versions`, op)).body
      .items as { note: string }[];
    expect(history.map((h) => h.note)).toContain(
      `Code ${base(m)} → ${base(m)}-A: ${base(m)}-B now leaves at the same time`,
    );
    expect((await create(m)).body.code).toBe(`${base(m)}-C`);
    // A copy at the same time is another service leaving then.
    const copy = await app.post(
      `/scheduling/services/${second.body.id}/clone`,
      { startDate: day(70), endDate: day(80) },
      { ...op, idempotencyKey: `e2e-sc-clone-${second.body.id}` },
    );
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    made.push({ id: copy.body.id });
    expect(copy.body.code).toBe(`${base(m)}-D`);
  });

  it('a copy at another time gets that time’s name', async () => {
    const m = await freeMinute();
    const src = await create(m);
    const later = await freeMinute();
    const copy = await app.post(
      `/scheduling/services/${src.body.id}/clone`,
      { startDate: day(70), endDate: day(80), startTime: hhmm(later) },
      { ...op, idempotencyKey: `e2e-sc-clone-${src.body.id}` },
    );
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    made.push({ id: copy.body.id });
    expect(copy.body.code).toBe(base(later));
    expect((await codes())[src.body.id]).toBe(base(m));
  });

  it('the form can ask what a new service would be called, before saving', async () => {
    const m = await freeMinute();
    const preview = (q: string, headers?: Record<string, string>) =>
      app.get(`/scheduling/services/code-preview?${q}`, headers ? { headers } : op);
    const q = `routeId=${route.id}&startTime=${hhmm(m)}`;
    expect((await preview(q)).body).toEqual({ code: base(m) });
    const first = await create(m);
    expect((await preview(q)).body).toEqual({
      code: `${base(m)}-B`,
      renames: { from: base(m), to: `${base(m)}-A` },
    });
    // Previewing changed nothing.
    expect((await codes())[first.body.id]).toBe(base(m));
    const second = await create(m);
    expect(second.body.renamed).toEqual({ from: base(m), to: `${base(m)}-A` });
    expect((await preview(q)).body).toEqual({ code: `${base(m)}-C` });
    expect((await preview(`routeId=${route.id}&startTime=25:00`)).status).toBe(400);
    expect((await preview(`routeId=nope&startTime=06:00`)).status).toBe(400);
    // Another operator's route is not found.
    expect((await preview(`routeId=${theirs.routeId}&startTime=06:00`)).status).toBe(404);
    expect((await preview(q, { 'x-tenant-slug': 'demo-travels' })).status).toBe(401);
  });

  it('the operator may type its own code: upper-cased, checked, unique', async () => {
    const own = `e2e night ${Date.now().toString().slice(-6)}`;
    const m = await freeMinute();
    const res = await create(m, { code: `  ${own} ` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.code).toBe(own.toUpperCase().replace(/ /g, '-'));
    expect((await create(m, { code: own })).status).toBe(409);
    for (const bad of ['A', 'DEL--JAI', '-DEL', 'DEL_JAI', 'X'.repeat(41)])
      expect((await create(m, { code: bad })).status, bad).toBe(400);
  });

  it('two created at once at the same time get different codes', async () => {
    const m = await freeMinute();
    const [a, b] = await Promise.all([create(m), create(m)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const all = await codes();
    expect([all[a.body.id], all[b.body.id]].sort()).toEqual([`${base(m)}-A`, `${base(m)}-B`]);
  });

  it('a retried request does not make a second service', async () => {
    const m = await freeMinute();
    const k = `e2e-sc-retry-${Date.now()}`;
    const send = () => app.post('/scheduling/services', body(m), { ...op, idempotencyKey: k });
    const first = await send();
    made.push({ id: first.body.id });
    const again = await send();
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.code).toBe(base(m));
    expect(Object.values(await codes()).filter((c) => c.startsWith(base(m)))).toHaveLength(1);
    expect((await app.post('/scheduling/services', body(m), op)).status).toBe(400); // no key
  });

  it('codes are per operator: another operator’s service at the same time is its own', async () => {
    const m = await freeMinute();
    expect((await create(m)).body.code).toBe(base(m));
    const their = await create(
      m,
      { routeId: theirs.routeId, vehicleTypeId: theirs.vehicleTypeId },
      other,
    );
    expect(their.status, JSON.stringify(their.body)).toBe(201);
    expect(their.body.code).toMatch(new RegExp(`-${hhmm(m).replace(':', '')}$`));
    // Ours was not renamed -A by theirs, and neither list shows the other's.
    expect(Object.values(await codes())).toContain(base(m));
    expect(Object.keys(await codes())).not.toContain(their.body.id);
    expect(Object.keys(await codes(other))).toContain(their.body.id);
  });

  it('only operator staff name services; the trip list shows the code and the bus', async () => {
    expect(
      (
        await app.post('/scheduling/services', body(5), {
          as: 'customer',
          idempotencyKey: `e2e-sc-cust-${Date.now()}`,
        })
      ).status,
    ).toBe(403);
    const date = (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op)).body.trip
      .journeyDate;
    const list = await app.get(`/scheduling/trips?date=${date}`, op);
    const row = list.body.items.find((t: { id: string }) => t.id === app.fixtures.tripId);
    expect(row.serviceCode).toEqual(expect.any(String));
    expect(row).toHaveProperty('busNumber');
    const detail = await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op);
    expect(detail.body.trip.serviceCode).toBe(row.serviceCode);
  });
});
