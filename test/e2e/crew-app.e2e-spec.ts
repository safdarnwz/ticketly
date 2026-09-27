import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, sqlOne } from './support/flows';

/**
 * The crew app: the operator gives a conductor a login; the conductor sees
 * only their own duties and acts only on the trips they are on duty for —
 * manifest, boarding, reports from the road, lost items, GPS, the panic button.
 */
describe('crew app (e2e)', () => {
  let app: TestApp;
  let crewId: string;
  let crew: { headers: Record<string, string> };
  let dutyId: string;
  const op = { as: 'operator' as const };
  const run = Date.now().toString(36);
  const phone = `96${String(Date.now()).slice(-8)}`;
  const password = 'Crew-pass-2026';
  let n = 0;
  const key = () => `e2e-crew-${run}-${++n}`;
  const unknownId = '00000000-0000-4000-8000-000000000000';

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const made = await app.post(
      '/fleet/crew',
      { role: 'conductor', fullName: `Conductor ${run}`, phone },
      op,
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    crewId = made.body.id;
  });
  afterAll(async () => {
    if (dutyId) await app.post(`/fleet/crew/duties/${dutyId}/cancel`, {}, op);
    await app.close();
  });

  it('the operator gives a crew member a login; the crew member signs in to the crew app only', async () => {
    const setLogin = (id: string, pw: string, opts: object = op) =>
      app.put(`/fleet/crew/${id}/login`, { password: pw }, opts);
    expect((await setLogin(crewId, 'short')).status).toBe(400);
    expect((await setLogin(unknownId, password)).status).toBe(404);
    expect((await setLogin(crewId, password, { as: 'customer' })).status).toBe(403);
    const first = await setLogin(crewId, password);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.created).toBe(true);
    expect((await setLogin(crewId, password)).body.created).toBe(false); // a reset, not a second user

    const login = await app.post(
      '/auth/login',
      { identifier: phone, password },
      { headers: { 'x-tenant-slug': app.fixtures.tenantSlug, 'x-debug-surface': 'tenantAdmin' } },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    crew = {
      headers: {
        authorization: `Bearer ${login.body.accessToken}`,
        'x-tenant-slug': app.fixtures.tenantSlug,
      },
    };
    const me = await app.get('/crew/me', crew);
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.crew.id).toBe(crewId);
    expect(me.body.duties).toEqual([]);
    // Not an operator console login.
    expect((await app.get('/fleet/crew', crew)).status).toBe(403);
    expect((await app.get('/bookings/search', crew)).status).toBe(403);
    // Staff are not crew.
    expect((await app.get('/crew/me', op)).status).toBe(403);
    // …and crew are not staff: the login is not on the staff list nor reachable by the staff endpoints.
    const { user_id: crewUserId } = await sqlOne<{ user_id: string }>(
      app,
      'SELECT user_id FROM crew WHERE id = $1',
      [crewId],
    );
    const staff = (await app.get('/users?limit=200', op)).body.items as { id: string }[];
    expect(staff.some((u) => u.id === crewUserId)).toBe(false);
    expect((await app.get(`/users/${crewUserId}`, op)).status).toBe(404);
    expect((await app.post(`/users/${crewUserId}/roles`, { roles: ['admin'] }, op)).status).toBe(
      404,
    );
  });

  it('only the trips on my duty: manifest, boarding, reports, lost item, GPS, panic', async () => {
    const f = app.fixtures;
    const trip = (await app.get(`/scheduling/trips/${f.tripId}`, op)).body.trip as {
      departsAt: string;
      arrivesAt: string;
    };
    // Before a duty, the trip does not exist for this login.
    expect((await app.get(`/crew/trips/${f.tripId}/manifest`, crew)).status).toBe(404);

    const duty = await app.post(
      '/fleet/crew/duties',
      {
        crewId,
        tripId: f.tripId,
        startsAt: new Date(Date.parse(trip.departsAt) - 30 * 60_000).toISOString(),
        endsAt: trip.arrivesAt,
        drivingMinutes: 0,
      },
      op,
    );
    expect(duty.status, JSON.stringify(duty.body)).toBe(201);
    dutyId = duty.body.id;
    const me = await app.get('/crew/me', crew);
    expect(me.body.duties).toHaveLength(1);
    expect(me.body.duties[0]).toMatchObject({
      id: dutyId,
      tripId: f.tripId,
      attendance: 'pending',
    });

    const { pnr } = await confirmedBooking(app, f.seatNumbers[0], {
      fullName: 'Crew Rider',
      age: 29,
    });
    const manifest = await app.get(`/crew/trips/${f.tripId}/manifest`, crew);
    expect(manifest.status).toBe(200);
    const row = (
      manifest.body.passengers as {
        pnr: string;
        ticketId: string;
        boardingPoint: string;
        ticketStatus: string;
      }[]
    ).find((p) => p.pnr === pnr)!;
    expect(row).toMatchObject({ boardingPoint: expect.any(String), ticketStatus: 'valid' });

    const board = (ticketId: string) =>
      app.post(`/crew/trips/${f.tripId}/tickets/${ticketId}/board`, {}, crew);
    expect((await board(row.ticketId)).body.status).toBe('boarded');
    expect((await board(row.ticketId)).body.status).toBe('already_boarded');
    expect((await board(unknownId)).status).toBe(404);
    expect(
      (await app.post(`/crew/trips/${f.tripId}/scan`, { boardingCode: 'NOPE123' }, crew)).status,
    ).toBe(404);

    const report = (body: object) =>
      app.post(`/crew/trips/${f.tripId}/incidents`, body, { ...crew, idempotencyKey: key() });
    expect(
      (await report({ type: 'cleaning', description: 'Seat 12 spill, needs cleaning' })).status,
    ).toBe(201);
    expect(
      (await report({ type: 'maintenance', description: 'AC vent 3 not cooling' })).status,
    ).toBe(201);
    expect(
      (await report({ type: 'delay', description: 'Jam', delayCategory: 'traffic' })).status,
    ).toBe(422);
    expect((await report({ type: 'sos' })).status).toBe(400); // the panic button is separate
    expect(
      (
        await app.post(
          `/crew/trips/${f.tripId}/lost-found`,
          { description: 'Blue water bottle', seatNumber: 'l1' },
          { ...crew, idempotencyKey: key() },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await app.post(
          `/crew/trips/${f.tripId}/ping`,
          { lat: 27.2, lng: 75.8, speedKmph: 42 },
          crew,
        )
      ).status,
    ).toBe(202);
    const sos = await app.post(
      `/crew/trips/${f.tripId}/sos`,
      { kind: 'medical', description: 'Passenger fainted' },
      { ...crew, idempotencyKey: key() },
    );
    expect(sos.status).toBe(201);
    expect(sos.body.severity).toBe('critical');

    // Another trip of the operator is not mine.
    const other = await sqlOne<{ id: string }>(
      app,
      `SELECT id FROM trips WHERE id <> $1 AND status IN ('scheduled','open') LIMIT 1`,
      [f.tripId],
    );
    expect((await app.get(`/crew/trips/${other.id}/manifest`, crew)).status).toBe(404);
    expect(
      (
        await app.post(
          `/crew/trips/${other.id}/sos`,
          { kind: 'sos' },
          { ...crew, idempotencyKey: key() },
        )
      ).status,
    ).toBe(404);
    // Staff who run trips still can.
    expect((await app.get(`/crew/trips/${other.id}/manifest`, op)).status).toBe(200);

    // My attendance: opens 6 hours before the duty.
    const att = await app.post(`/crew/me/duties/${dutyId}/attendance`, {}, crew);
    expect([200, 422]).toContain(att.status);
    expect((await app.post(`/crew/me/duties/${unknownId}/attendance`, {}, crew)).status).toBe(404);
  });

  it('crew on leave cannot use the app', async () => {
    await app.post(`/fleet/crew/duties/${dutyId}/cancel`, {}, op);
    dutyId = '';
    expect((await app.patch(`/fleet/crew/${crewId}`, { status: 'on_leave' }, op)).status).toBe(200);
    expect((await app.get('/crew/me', crew)).status).toBe(403);
  });
});
