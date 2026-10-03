import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, departingSoon, sqlOne, type TripLeg } from './support/flows';

/**
 * The tabs under the seat map (highlights, cancellation, route, boarding /
 * dropping points, features, reviews, safety, about the bus, policies) and
 * reviews that belong to the bus: a review is kept with the bus that actually
 * ran the trip. When the operator later runs another bus on the same service,
 * the old bus keeps its stars and the new one starts from its own.
 */
describe('bus details under the seat map; reviews stay with the bus (e2e)', () => {
  let app: TestApp;
  const op = { as: 'operator' as const };
  const anon = { as: 'anonymous' as const };
  const run = Date.now().toString().slice(-6);
  let routeId: string;
  let ran: TripLeg; // the trip ABCD ran, reviewed afterwards
  let next: TripLeg; // a later trip of the same route, on XYZ
  let abcd: string;
  let xyz: string;
  let traveller: { bookingId: string; pnr: string };
  let otherOperator: Record<string, string>;

  /** A verified bus with papers valid until 2031, on the given trip's seat layout. */
  const newBus = async (reg: string, tripId: string) => {
    const bus = await sqlOne<{ id: string }>(
      app,
      `INSERT INTO vehicles (tenant_id, registration_no, vehicle_type_id, seat_layout_id, status, verification_status)
       SELECT t.tenant_id, $1, (SELECT id FROM vehicle_types WHERE tenant_id = t.tenant_id LIMIT 1),
              t.seat_layout_id, 'active', 'approved'
         FROM trips t WHERE t.id = $2 RETURNING id`,
      [reg, tripId],
    );
    for (const doc of ['permit', 'insurance', 'fitness', 'puc'])
      await sqlOne(
        app,
        `INSERT INTO vehicle_documents (tenant_id, vehicle_id, doc_type, document_no, valid_from, expires_on, verification_status)
         SELECT tenant_id, $1, $2, $3, '2025-01-01', '2031-12-31', 'verified' FROM vehicles WHERE id = $1`,
        [bus.id, doc, `${doc.toUpperCase()}-${reg}`],
      );
    return bus.id;
  };
  const setBus = (tripId: string, vehicleId: string) =>
    app.post(
      `/trips/${tripId}/vehicle`,
      { vehicleId, reason: 'Planned bus for this run' },
      { ...op, idempotencyKey: `e2e-bd-${tripId}-${vehicleId}` },
    );
  const legOf = async (tripId: string): Promise<TripLeg> => {
    const chart = (await app.get(`/bookings/trips/${tripId}/chart`, op)).body;
    return {
      tripId,
      fromStopId: chart.stops[0].stopId,
      toStopId: chart.stops[chart.stops.length - 1].stopId,
    };
  };
  const details = (leg: TripLeg, headers?: Record<string, string>) =>
    app.get(
      `/search/trips/${leg.tripId}/details?from=${leg.fromStopId}&to=${leg.toStopId}`,
      headers ? { headers } : anon,
    );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const f = app.fixtures;
    routeId = (await app.get(`/scheduling/trips/${f.tripId}`, op)).body.trip.routeId;
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
    // Two open trips of the fixture route a few days apart, which this test gives
    // buses of its own (the middle of the range: other suites take the earliest and latest).
    const { ids: spare } = await sqlOne<{ ids: string[] }>(
      app,
      `SELECT coalesce(array_agg(id), '{}') AS ids FROM (
         SELECT t.id FROM trips t
          WHERE t.route_id = $1 AND t.id <> $2 AND t.status = 'open'
            -- a seater bus (the booking helpers quote seater seats)
            AND EXISTS (SELECT 1 FROM trip_seats ts WHERE ts.trip_id = t.id AND ts.seat_type = 'seater')
            AND t.journey_date BETWEEN current_date + 3 AND current_date + 20
            AND t.departs_at > now() + interval '2 days'
            AND (SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                  WHERE bs.trip_id = t.id AND b.status IN ('held', 'confirmed')) < 10
          ORDER BY random() LIMIT 2) x`,
      [routeId, f.tripId],
    );
    expect(spare.length, 'two open trips of the fixture route').toBe(2);
    ran = await legOf(spare[0]);
    next = await legOf(spare[1]);
    abcd = await newBus(`AB${run}CD`, ran.tripId);
    xyz = await newBus(`XY${run}Z`, next.tripId);
    for (const [tripId, bus] of [
      [ran.tripId, abcd],
      [next.tripId, xyz],
    ]) {
      const set = await setBus(tripId, bus);
      expect(set.status, JSON.stringify(set.body)).toBe(200);
    }

    const map = await app.get(
      `/scheduling/trips/${ran.tripId}/availability?from=${ran.fromStopId}&to=${ran.toStopId}`,
      anon,
    );
    const seat = (
      map.body.seats as {
        seatNumber: string;
        available: boolean;
        ladiesOnly: boolean;
        accessible: boolean;
        reservedFor: string | null;
      }[]
    ).find((s) => s.available && !s.ladiesOnly && !s.accessible && !s.reservedFor)!.seatNumber;
    traveller = await confirmedBooking(app, seat, { fullName: 'Asha Verma', age: 34 }, ran);
  });
  afterAll(async () => {
    await app.close();
  });

  it('every tab has its data, for anyone, before booking', async () => {
    const res = await details(ran);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body;
    expect(d.bus).toMatchObject({ id: abcd });
    expect(d.bus.seats).toBeGreaterThan(0);
    expect(d.cancellation.rows.length).toBeGreaterThan(0);
    // Tiers run back to back, from "any time before" to departure.
    const rows = d.cancellation.rows as { from: string | null; until: string }[];
    expect(rows[0].from).toBeNull();
    for (let i = 1; i < rows.length; i += 1) expect(rows[i].from).toBe(rows[i - 1].until);
    expect(d.route.stops.length).toBeGreaterThanOrEqual(2);
    expect(d.boardingPoints.length).toBeGreaterThan(0);
    expect(d.droppingPoints.length).toBeGreaterThan(0);
    expect(d.safety.find((s: { key: string }) => s.key === 'papers')).toMatchObject({ ok: true });
    expect(d.reviews).toMatchObject({ count: 0, average: null });
    // Driver names and phones are not in the public details.
    expect(JSON.stringify(d)).not.toMatch(/"phone"/);
  });

  it('a wrong leg or trip is refused', async () => {
    const back = await app.get(
      `/search/trips/${ran.tripId}/details?from=${ran.toStopId}&to=${ran.fromStopId}`,
      anon,
    );
    expect(back.status).toBe(422);
    expect((await app.get(`/search/trips/not-a-uuid/details`, anon)).status).toBe(400);
    expect(
      (await app.get(`/search/trips/${ran.tripId}/details?from=nope&to=${ran.toStopId}`, anon))
        .status,
    ).toBe(400);
    expect(
      (await app.get(`/search/trips/01a0e37b-0000-7000-8000-000000000000/details`, anon)).status,
    ).toBe(404);
    // Another operator cannot read this operator's trip.
    expect((await details(ran, { 'x-tenant-slug': 'maharaja-yatra' })).status).toBe(404);
  });

  it('the review is written against the bus that ran — and stays there after the service moves to another bus', async () => {
    const review = (body: object) =>
      app.post(
        '/reviews',
        { bookingId: traveller.bookingId, rating: 4, title: 'Clean bus', ...body },
        { idempotencyKey: `e2e-bd-review-${traveller.bookingId}-${Date.now()}` },
      );
    await departingSoon(app, ran.tripId);
    expect(
      (await app.post(`/crew/trips/${ran.tripId}/status`, { status: 'departed' }, op)).status,
    ).toBe(201);

    expect((await review({ liked: ['wifi'] })).status).toBe(400);
    expect((await review({ liked: Array(9).fill('ac') })).status).toBe(400);
    const ok = await review({ liked: ['cleanliness', 'staff', 'staff'] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const stored = await sqlOne<{ vehicle_id: string; liked: string[] }>(
      app,
      `SELECT vehicle_id, liked FROM reviews WHERE booking_id = $1`,
      [traveller.bookingId],
    );
    expect(stored.vehicle_id).toBe(abcd);
    expect(stored.liked.sort()).toEqual(['cleanliness', 'staff']);

    // ABCD's page has it; XYZ — now on the same route — does not.
    const forAbcd = await app.get(`/buses/${abcd}/reviews`, anon);
    expect(forAbcd.status, JSON.stringify(forAbcd.body)).toBe(200);
    expect(forAbcd.body).toMatchObject({ average: 4, count: 1 });
    expect(forAbcd.body.distribution['4']).toBe(1);
    expect(forAbcd.body.liked).toEqual(
      expect.arrayContaining([expect.objectContaining({ aspect: 'staff', count: 1 })]),
    );
    expect(forAbcd.body.items[0]).toMatchObject({ rating: 4, liked: ['cleanliness', 'staff'] });
    // Only the reviewer's first name is public.
    expect(forAbcd.body.items[0].reviewer).toBe('Asha');
    expect(JSON.stringify(forAbcd.body)).not.toMatch(/Verma|pnr/i);

    const forXyz = await app.get(`/buses/${xyz}/reviews`, anon);
    expect(forXyz.body).toMatchObject({ average: null, count: 0, items: [] });
    expect((await details(next)).body.reviews).toMatchObject({ count: 0 });

    // Search shows each bus its own stars: the later trip on XYZ has none.
    const day = (id: string) =>
      sqlOne<{ d: string }>(app, `SELECT journey_date::text AS d FROM trips WHERE id = $1`, [id]);
    const search = await app.post(
      '/search',
      {
        originCityId: app.fixtures.originCityId,
        destCityId: app.fixtures.destCityId,
        journeyDate: (await day(next.tripId)).d,
      },
      anon,
    );
    const hit = search.body.results.find((r: { tripId: string }) => r.tripId === next.tripId);
    expect(hit).toMatchObject({ rating: null, ratingCount: 0 });
  });

  it('the operator sees each bus its own reviews and stars', async () => {
    const mine = await app.get(`/reviews?vehicleId=${abcd}`, op);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({
      pnr: traveller.pnr,
      vehicleId: abcd,
      busNumber: `AB${run}CD`,
      liked: ['cleanliness', 'staff'],
    });
    expect(mine.body.summary).toMatchObject({ count: 1, average: 4 });
    const other = await app.get(`/reviews?vehicleId=${xyz}`, op);
    expect(other.body.items).toEqual([]);
    expect(other.body.summary.count).toBe(0);
    expect((await app.get('/reviews?vehicleId=nope', op)).status).toBe(400);
    // Another operator filtering by this bus sees nothing of it.
    const theirs = await app.get(`/reviews?vehicleId=${abcd}`, { headers: otherOperator });
    expect(theirs.status).toBe(200);
    expect(theirs.body.items).toEqual([]);
  });

  it('bus reviews: pagination, unknown bus, another operator', async () => {
    expect((await app.get(`/buses/${abcd}/reviews?limit=51`, anon)).status).toBe(400);
    expect((await app.get(`/buses/${abcd}/reviews?offset=-1`, anon)).status).toBe(400);
    const past = await app.get(`/buses/${abcd}/reviews?offset=5`, anon);
    expect(past.status).toBe(200);
    expect(past.body.items).toEqual([]);
    expect(past.body.count).toBe(1);
    expect(
      (await app.get(`/buses/01a0e37b-0000-7000-8000-000000000000/reviews`, anon)).status,
    ).toBe(404);
    expect(
      (await app.get(`/buses/${abcd}/reviews`, { headers: { 'x-tenant-slug': 'maharaja-yatra' } }))
        .status,
    ).toBe(404);
  });

  it('travel policies: operator publishes, customers see them, bad input refused', async () => {
    const put = (body: object, opts: object = op) =>
      app.put('/operator/travel-policies', body, opts);
    const good = {
      pets: 'small_in_carrier',
      liquor: 'prohibited',
      smoking: 'at_stops_only',
      pickupWaitMinutes: 10,
      notes: ['Carry a photo ID'],
    };
    expect((await put({ ...good, pets: 'dogs' })).status).toBe(400);
    expect((await put({ ...good, pickupWaitMinutes: 31 })).status).toBe(400);
    expect((await put({ ...good, notes: ['x'] })).status).toBe(400);
    expect((await put({ ...good, notes: Array(9).fill('Be on time') })).status).toBe(400);
    expect((await put(good, { as: 'customer' })).status).toBe(403);
    expect((await put(good, anon)).status).toBe(401);

    const ok = await put(good);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await app.get('/operator/travel-policies', op)).body.policies).toMatchObject(good);
    const shown = (await details(next)).body.policies;
    expect(JSON.stringify(shown)).toMatch(/Carry a photo ID/);

    // Another operator's policies are their own.
    const theirs = await app.get('/operator/travel-policies', { headers: otherOperator });
    expect(theirs.status).toBe(200);
    expect(JSON.stringify(theirs.body.policies ?? {})).not.toMatch(/Carry a photo ID/);

    expect((await app.post('/operator/travel-policies/reset', {}, op)).status).toBe(200);
    expect((await app.get('/operator/travel-policies', op)).body.policies).toBeNull();
  });
});
