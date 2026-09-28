import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { sqlOne } from './support/flows';

/**
 * Government rules per state (liquor, smoking…) are set by the platform. A
 * route carries the rules of every state its stops are in — worked out from
 * the stops, so the operator cannot drop one — and passengers see them under
 * the seat map.
 */
describe('state rules: set by the platform, carried by every route, shown to passengers (e2e)', () => {
  let app: TestApp;
  const admin = { as: 'platformAdmin' as const };
  const op = { as: 'operator' as const };
  const run = Date.now().toString().slice(-6);
  let routeId: string;
  let state: { id: string; name: string };
  let cities: string[];
  let other: Record<string, string>;
  const made: string[] = [];

  const add = (body: object, opts: object = admin) => app.post('/admin/state-norms', body, opts);
  const rulesOnRoute = async () =>
    (await app.get(`/master-data/routes/${routeId}/state-norms`, op)).body.states as {
      stateId: string;
      norms: { id: string; title: string }[];
    }[];
  const onTrip = async () =>
    (await app.get(`/search/trips/${app.fixtures.tripId}/details`, { as: 'anonymous' })).body
      .stateRules as { stateId: string; norms: { id: string; title: string }[] }[];

  beforeAll(async () => {
    app = await bootstrapTestApp();
    routeId = (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, op)).body.trip.routeId;
    const row = await sqlOne<{ id: string; name: string; cities: string[] }>(
      app,
      `SELECT st.id, st.name, array_agg(DISTINCT c.id::text) AS cities
         FROM route_stops rs JOIN stops s ON s.id = rs.stop_id JOIN cities c ON c.id = s.city_id
         JOIN states st ON st.id = c.state_id
        WHERE rs.route_id = $1 GROUP BY st.id, st.name ORDER BY min(rs.sequence) LIMIT 1`,
      [routeId],
    );
    state = { id: row.id, name: row.name };
    cities = row.cities;
    const login = await app.post(
      '/auth/login',
      { identifier: 'admin@maharaja-yatra.example', password: 'pass@123' },
      { headers: { 'x-tenant-slug': 'maharaja-yatra', 'x-debug-surface': 'tenantAdmin' } },
    );
    other = {
      authorization: `Bearer ${login.body.accessToken}`,
      'x-tenant-slug': 'maharaja-yatra',
    };
  });
  afterAll(async () => {
    // Rules are switched off, never deleted.
    for (const id of made) await app.patch(`/admin/state-norms/${id}`, { isActive: false }, admin);
    await app.close();
  });

  it('only the platform sets rules, and they are checked', async () => {
    const states = await app.get('/admin/state-norms/states', admin);
    expect(states.status).toBe(200);
    expect(states.body.items.map((s: { id: string }) => s.id)).toContain(state.id);

    const good = {
      stateId: state.id,
      category: 'liquor',
      title: `Liquor ban ${run}`,
      body: 'Carrying or drinking liquor is a punishable offence in this state.',
    };
    expect((await add(good, op)).status).toBe(403);
    expect((await add(good, { as: 'customer' })).status).toBe(403);
    expect((await add(good, { as: 'anonymous' })).status).toBe(401);
    expect((await add({ ...good, category: 'drugs' })).status).toBe(400);
    expect((await add({ ...good, title: 'x' })).status).toBe(400);
    expect((await add({ ...good, body: 'y'.repeat(501) })).status).toBe(400);
    expect((await add({ ...good, stateId: '01a0e37b-0000-7000-8000-000000000000' })).status).toBe(
      404,
    );

    const ok = await add(good);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ stateId: state.id, stateName: state.name, isActive: true });
    made.push(ok.body.id);
    // Same title in the same state (any case) is refused.
    expect((await add({ ...good, title: good.title.toUpperCase() })).status).toBe(409);
  });

  it('every route through the state carries the rule; the operator cannot drop it', async () => {
    const [id] = made;
    const states = await rulesOnRoute();
    const mine = states.find((s) => s.stateId === state.id);
    expect(mine?.norms.map((n) => n.id)).toContain(id);
    // While drawing a route: the same rules from its cities.
    const drawing = await app.get(`/master-data/state-norms?cityIds=${cities.join(',')}`, op);
    expect(drawing.status).toBe(200);
    expect(
      drawing.body.states
        .find((s: { stateId: string }) => s.stateId === state.id)
        .norms.map((n: { id: string }) => n.id),
    ).toContain(id);
    expect((await app.get('/master-data/state-norms?cityIds=nope', op)).status).toBe(400);
    expect((await app.get('/master-data/state-norms?cityIds=', op)).status).toBe(400);

    // No operator way to switch it off or change it.
    expect((await app.patch(`/admin/state-norms/${id}`, { isActive: false }, op)).status).toBe(403);
    // Another operator cannot read this operator's route.
    expect(
      (await app.get(`/master-data/routes/${routeId}/state-norms`, { headers: other })).status,
    ).toBe(404);
  });

  it('passengers see it under the seat map, and not once it is switched off', async () => {
    const [id] = made;
    const shown = (await onTrip()).find((s) => s.stateId === state.id);
    expect(shown?.norms.map((n) => n.id)).toContain(id);

    const off = await app.patch(`/admin/state-norms/${id}`, { isActive: false }, admin);
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const after = (await onTrip()).find((s) => s.stateId === state.id);
    expect(after?.norms.map((n) => n.id) ?? []).not.toContain(id);
    expect(
      (await rulesOnRoute()).find((s) => s.stateId === state.id)?.norms.map((n) => n.id),
    ).not.toContain(id);
    // Still in the admin list when asked for switched-off ones.
    const all = await app.get(`/admin/state-norms?stateId=${state.id}&includeInactive=true`, admin);
    expect(all.body.items.map((n: { id: string }) => n.id)).toContain(id);
    const active = await app.get(`/admin/state-norms?stateId=${state.id}`, admin);
    expect(active.body.items.map((n: { id: string }) => n.id)).not.toContain(id);

    expect((await app.patch(`/admin/state-norms/${id}`, { isActive: true }, admin)).status).toBe(
      200,
    );
    expect((await app.patch(`/admin/state-norms/${id}`, {}, admin)).status).toBe(400);
    expect(
      (
        await app.patch(
          '/admin/state-norms/01a0e37b-0000-7000-8000-000000000000',
          { title: 'Does not exist' },
          admin,
        )
      ).status,
    ).toBe(404);
  });
});
