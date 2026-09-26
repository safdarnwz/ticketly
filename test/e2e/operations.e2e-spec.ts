import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/** Dispatch desk: incidents, lost & found, shift notes, dispatch report, cancel suggestions. */
describe('operations (e2e)', () => {
  let app: TestApp;
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const unknownId = '01a0dddd-0000-7000-8000-000000000000';
  const as = { as: 'operator' as const };
  const key = (k: string) => ({ ...as, idempotencyKey: `e2e-ops-${k}-${run}` });

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('incidents: validated report, then open → acknowledged → resolved (with a note) → closed', async () => {
    const tripId = app.fixtures.tripId;
    expect(
      (await app.post('/incidents', { type: 'breakdown', tripId, description: 'x' }, key('i0')))
        .status,
    ).toBe(422);
    expect(
      (
        await app.post(
          '/incidents',
          { type: 'delay', tripId, description: 'Stuck in traffic' },
          key('i1'),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await app.post(
          '/incidents',
          { type: 'breakdown', tripId: unknownId, description: 'Tyre burst' },
          key('i2'),
        )
      ).status,
    ).toBe(404);
    const made = await app.post(
      '/incidents',
      { type: 'breakdown', tripId, description: 'Tyre burst near toll' },
      key('i3'),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.severity).toBe('high');
    const id: string = made.body.id;

    const fuel = await app.post(
      '/incidents',
      { type: 'fuel', tripId, description: 'Tank near empty, next pump 60 km' },
      key('i4'),
    );
    expect(fuel.status, JSON.stringify(fuel.body)).toBe(201);
    expect(fuel.body.severity).toBe('high');

    const listed = await app.get(`/incidents?status=active&tripId=${tripId}`, as);
    expect(listed.body.items.find((i: { id: string }) => i.id === id)).toMatchObject({
      status: 'open',
    });

    const move = (status: string, note?: string) =>
      app.post(`/incidents/${id}/status`, { status, note }, as);
    expect((await move('closed')).status).toBe(422);
    expect((await move('acknowledged')).status).toBe(200);
    expect((await move('resolved')).status).toBe(422); // needs a resolution note
    expect((await move('resolved', 'Spare fitted, bus moving')).status).toBe(200);
    expect((await move('closed')).status).toBe(200);
    expect((await move('acknowledged')).status).toBe(422);
    expect(
      (await app.post(`/incidents/${unknownId}/status`, { status: 'closed' }, as)).status,
    ).toBe(404);
  });

  it("lost & found: this operator's trips only, a claim needs the trip's PNR, disposal waits 30 days", async () => {
    expect(
      (await app.post('/lost-found', { tripId: unknownId, description: 'Black bag' }, key('l0')))
        .status,
    ).toBe(404);
    expect((await app.post('/lost-found', { description: 'Umbrella' }, as)).status).toBe(400); // no idempotency key
    const body = { tripId: app.fixtures.tripId, description: 'Black backpack', seatNumber: 'l4' };
    const first = await app.post('/lost-found', body, key('l1'));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await app.post('/lost-found', body, key('l1'));
    expect(again.body.id).toBe(first.body.id); // a double click logs it once
    const id: string = first.body.id;

    const list = await app.get('/lost-found?status=found', as);
    expect(list.body.items.find((i: { id: string }) => i.id === id)).toMatchObject({
      seat_number: 'L4',
    });

    const claim = (b: Record<string, unknown>) => app.post(`/lost-found/${id}/claim`, b, as);
    expect((await claim({ claimantName: 'Asha Rao' })).status).toBe(422);
    expect((await claim({ claimantName: 'Asha Rao', pnr: 'NOPE0000' })).status).toBe(422);
    expect((await app.post(`/lost-found/${id}/dispose`, {}, as)).status).toBe(422);
    expect(
      (await app.post(`/lost-found/${unknownId}/claim`, { claimantName: 'Asha Rao' }, as)).status,
    ).toBe(404);
  });

  it('shift notes: a branch note names an active branch of ours; a dispatch note names none', async () => {
    expect(
      (await app.post('/shift-notes', { scope: 'branch', note: 'Printer jammed' }, key('n0')))
        .status,
    ).toBe(422);
    expect(
      (
        await app.post(
          '/shift-notes',
          { scope: 'branch', note: 'Printer jammed', branchId: unknownId },
          key('n1'),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.post(
          '/shift-notes',
          { scope: 'dispatch', note: 'All buses out', branchId: unknownId },
          key('n2'),
        )
      ).status,
    ).toBe(422);
    const note = `Bus 7 AC weak — ${run}`;
    expect((await app.post('/shift-notes', { scope: 'dispatch', note }, key('n3'))).status).toBe(
      201,
    );
    expect((await app.post('/shift-notes', { scope: 'dispatch', note }, key('n3'))).status).toBe(
      201,
    );
    const notes = await app.get('/shift-notes?scope=dispatch', as);
    expect(notes.body.items.filter((n: { note: string }) => n.note === note)).toHaveLength(1);
  });

  it('reports: dispatch period capped at a year; a cancel decision only for an upcoming trip', async () => {
    expect((await app.get('/reports/dispatch?from=2020-01-01&to=2026-12-31', as)).status).toBe(422);
    const ok = await app.get('/reports/dispatch?from=2026-01-01&to=2026-03-31', as);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('summary');

    const decide = (tripId: string) =>
      app.post(
        `/trips/${tripId}/cancel-suggestion/decision`,
        { decision: 'rejected', reason: 'Festival rush expected' },
        as,
      );
    expect((await decide(unknownId)).status).toBe(404);
    expect((await decide(app.fixtures.tripId)).status).toBe(200);

    const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const past = (await app.get(`/scheduling/trips?date=${yesterday}`, as)).body.items?.[0];
    if (past) expect((await decide(past.id)).status).toBe(422);
  });
});
