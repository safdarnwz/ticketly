import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, departingSoon, sqlOne } from './support/flows';

/**
 * A bus's operations: the reservation chart, stopping and resuming sales,
 * blocking seats — and none of it once the bus has left ('closed' after the
 * journey used to look like "sales stopped", so a finished trip could be
 * cancelled — refunding everyone who travelled — or put back on sale).
 */
describe('trip operations (e2e)', () => {
  let app: TestApp;
  const op = { as: 'operator' as const };

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const chart = (tripId: string) => app.get(`/bookings/trips/${tripId}/chart`, op);

  it('the chart shows every seat and who travels in it, for staff only', async () => {
    const f = app.fixtures;
    const { pnr } = await confirmedBooking(app, f.seatNumbers[0], {
      fullName: 'Chart Person',
      age: 44,
      gender: 'female',
    });
    const r = await chart(f.tripId);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.seats.length).toBe(r.body.trip.totalSeats);
    const seat = r.body.seats.find(
      (s: { seatNumber: string }) => s.seatNumber === f.seatNumbers[0],
    );
    const who = seat.occupants.find((o: { pnr: string }) => o.pnr === pnr);
    expect(who).toMatchObject({ name: 'Chart Person', age: 44, onHold: false });
    expect(who.from).toBeTruthy();
    expect(who.to).toBeTruthy();
    expect(r.body.totals.passengers).toBeGreaterThanOrEqual(1);
    expect(r.body.trip.hasRun).toBe(false);

    expect((await app.get(`/bookings/trips/${f.tripId}/chart`)).status).toBe(403); // a customer
    expect(
      (await app.get(`/bookings/trips/${f.tripId}/chart`, { as: 'anonymous' })).status,
    ).toBeGreaterThanOrEqual(401);
    expect((await chart('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('stops and resumes sales (this used to fail with a database error)', async () => {
    const id = app.fixtures.tripId;
    expect((await app.post(`/bookings/trips/${id}/stop-sales`, {}, op)).status).toBe(200);
    expect((await chart(id)).body.trip.status).toBe('closed');
    expect((await app.post(`/bookings/trips/${id}/stop-sales`, {}, op)).status).toBe(422);
    expect((await app.post(`/bookings/trips/${id}/resume-sales`, {}, op)).status).toBe(200);
    expect((await chart(id)).body.trip.status).toBe('open');
  });

  it('blocks and opens seats; unknown seats are refused', async () => {
    const f = app.fixtures;
    const body = (seatNumbers: string[], block: boolean) => ({
      seatNumbers,
      fromStopId: f.fromStopId,
      toStopId: f.toStopId,
      block,
    });
    const seat = f.seatNumbers[3];
    expect(
      (await app.post(`/scheduling/trips/${f.tripId}/block-seats`, body(['NOPE'], true), op))
        .status,
    ).toBe(400);
    expect(
      (await app.post(`/scheduling/trips/${f.tripId}/block-seats`, body([seat, seat], true), op))
        .status,
    ).toBe(201);
    let s = (await chart(f.tripId)).body.seats.find(
      (x: { seatNumber: string }) => x.seatNumber === seat,
    );
    expect(s.blocked).toBe(true);
    expect(
      (await app.post(`/scheduling/trips/${f.tripId}/block-seats`, body([seat], false), op)).status,
    ).toBe(201);
    s = (await chart(f.tripId)).body.seats.find(
      (x: { seatNumber: string }) => x.seatNumber === seat,
    );
    expect(s.blocked).toBe(false);
  });

  it('a bus that has left cannot be cancelled, put back on sale or re-blocked', async () => {
    // Another open trip of the operator, after the fixture's (each run uses one up).
    let spare: { id: string } | undefined;
    for (let d = 5; d <= 28 && !spare; d += 1) {
      const day = new Date(Date.parse(app.fixtures.journeyDate) + d * 864e5)
        .toISOString()
        .slice(0, 10);
      const list = await app.get(`/scheduling/trips?date=${day}`, op);
      spare = list.body.items.find(
        (t: { id: string; status: string }) => t.id !== app.fixtures.tripId && t.status === 'open',
      );
    }
    expect(spare, 'an open trip in the next weeks').toBeDefined();
    const id = spare!.id;

    const crew = (status: string) => app.post(`/crew/trips/${id}/status`, { status }, op);
    expect((await crew('departed')).status).toBe(422); // days before its time
    await departingSoon(app, id);
    expect((await crew('closed')).status).toBe(422); // not departed yet
    expect((await crew('departed')).status).toBe(201);
    expect((await chart(id)).body.trip.hasRun).toBe(true);
    expect(
      (
        await app.post(
          `/bookings/trips/${id}/cancel`,
          { reason: 'too late' },
          { ...op, idempotencyKey: `late-${id}` },
        )
      ).status,
    ).toBe(422);
    expect((await crew('closed')).status).toBe(201);
    expect((await chart(id)).body.trip.status).toBe('closed');
    // The journey is over: still no cancel, and no selling it again.
    expect(
      (
        await app.post(
          `/bookings/trips/${id}/cancel`,
          { reason: 'after arrival' },
          { ...op, idempotencyKey: `late2-${id}` },
        )
      ).status,
    ).toBe(422);
    expect((await app.post(`/bookings/trips/${id}/resume-sales`, {}, op)).status).toBe(422);
    const stops = (await chart(id)).body.stops;
    expect(
      (
        await app.post(
          `/scheduling/trips/${id}/block-seats`,
          {
            seatNumbers: ['1'],
            fromStopId: stops[0].stopId,
            toStopId: stops[stops.length - 1].stopId,
            block: true,
          },
          op,
        )
      ).status,
    ).toBe(400);
  });

  it('seat quotas for an agent or branch: free seats only, active holders only, released on demand', async () => {
    const f = app.fixtures;
    const run = Date.now().toString(36);
    const agent = await app.post(
      '/agents',
      {
        name: `Quota Travels ${run}`,
        contactPhone: `96${String(Date.now()).slice(-8)}`,
        billingMode: 'prepaid',
        commissionPct: 5,
        loginEmail: `quota.${run}@demo-travels.example`,
        password: 'Quota-pass-123',
      },
      { ...op, idempotencyKey: `e2e-quota-agent-${run}` },
    );
    expect(agent.status, JSON.stringify(agent.body)).toBe(201);
    const holderId = agent.body.agentId as string;
    const c = (await chart(f.tripId)).body as {
      seats: { seatNumber: string; blocked: boolean; bookable: boolean; occupants: unknown[] }[];
    };
    const free = c.seats.filter((s) => s.bookable && !s.blocked && s.occupants.length === 0);
    const sold = c.seats.find((s) => s.occupants.length > 0);
    const seat = free[free.length - 1].seatNumber;
    const allocate = (body: object) =>
      app.post(
        `/trips/${f.tripId}/quotas`,
        { seatNumbers: [seat], holderType: 'agent', holderId, releaseMinutesBefore: 120, ...body },
        { ...op, idempotencyKey: `e2e-quota-${run}-${Math.random()}` },
      );
    if (sold) expect((await allocate({ seatNumbers: [sold.seatNumber] })).status).toBe(409);
    expect((await allocate({ seatNumbers: ['NOPE-1'] })).status).toBe(404);
    expect((await allocate({ holderId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    const ok = await allocate({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(201); // every allocation used to fail as "already sold"
    expect((await allocate({})).status).toBe(409); // allocated already
    const list = (await app.get(`/trips/${f.tripId}/quotas`, op)).body.items as {
      seatNumber: string;
    }[];
    expect(list.map((q) => q.seatNumber)).toContain(seat);
    const release = await app.post(
      `/trips/${f.tripId}/quotas/release`,
      { seatNumbers: [seat], reason: 'Back to general sale' },
      { ...op, idempotencyKey: `e2e-quota-rel-${run}` },
    );
    expect(release.status, JSON.stringify(release.body)).toBe(200);
    await app.post(
      `/agents/${holderId}/status`,
      { status: 'suspended', reason: 'End of the e2e run' },
      op,
    );
    expect((await allocate({})).status).toBe(422); // suspended agent
  });

  it('sales channels per trip, shown on the chart', async () => {
    const f = app.fixtures;
    const set = (closed: string[]) => app.put(`/trips/${f.tripId}/closed-channels`, { closed }, op);
    expect((await set(['ota', 'agent'])).status).toBe(200);
    expect((await chart(f.tripId)).body.trip.closedOnTrip.sort()).toEqual(['agent', 'ota']);
    expect((await set(['teleport'])).status).toBe(400);
    expect((await set([])).status).toBe(200);
    expect((await chart(f.tripId)).body.trip.closedOnTrip).toEqual([]);
  });

  it('a no-show is marked only after the bus was due to leave', async () => {
    const f = app.fixtures;
    const seats = (await chart(f.tripId)).body.seats as {
      seatNumber: string;
      blocked: boolean;
      bookable: boolean;
      occupants: unknown[];
    }[];
    const free = seats.filter((s) => s.bookable && !s.blocked && !s.occupants.length);
    const { bookingId } = await confirmedBooking(app, free[1].seatNumber, {
      fullName: 'Early Bird',
    });
    const t = (await app.get(`/bookings/${bookingId}/tickets`, op)).body.tickets[0];
    const r = await app.post(`/bookings/tickets/${t.ticketId}/no-show`, {}, op);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.detail).toMatch(/not left yet/);
    expect(
      (await app.post('/bookings/tickets/00000000-0000-4000-8000-000000000000/no-show', {}, op))
        .status,
    ).toBe(404);
  });

  it("a no-show waits for the operator's grace period after departure", async () => {
    const f = app.fixtures;
    const seats = (await chart(f.tripId)).body.seats as {
      seatNumber: string;
      blocked: boolean;
      bookable: boolean;
      occupants: unknown[];
    }[];
    const free = seats.filter((s) => s.bookable && !s.blocked && !s.occupants.length);
    const { bookingId } = await confirmedBooking(app, free[2].seatNumber, {
      fullName: 'Late Comer',
    });
    const t = (await app.get(`/bookings/${bookingId}/tickets`, op)).body.tickets[0];
    const policy = (await app.get('/operator/refund-policy', op)).body;
    const was = await sqlOne<{ d: string; a: string }>(
      app,
      'SELECT departs_at AS d, arrives_at AS a FROM trips WHERE id = $1',
      [f.tripId],
    );
    try {
      // The bus left 10 minutes ago; the policy waits 15.
      await sqlOne(
        app,
        `UPDATE trips SET arrives_at = arrives_at - (departs_at - (now() - interval '10 minutes')),
                          departs_at = now() - interval '10 minutes' WHERE id = $1`,
        [f.tripId],
      );
      expect(
        (
          await app.patch(
            '/operator/refund-policy',
            { ...policy.policy, noShowGraceMinutes: 15 },
            op,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await app.patch(
            '/operator/refund-policy',
            { ...policy.policy, noShowGraceMinutes: 500 },
            op,
          )
        ).status,
      ).toBe(400);
      const early = await app.post(`/bookings/tickets/${t.ticketId}/no-show`, {}, op);
      expect(early.status).toBe(422);
      expect(early.body.detail).toMatch(/waits 15 minutes/);
      await app.patch('/operator/refund-policy', { ...policy.policy, noShowGraceMinutes: 5 }, op);
      expect((await app.post(`/bookings/tickets/${t.ticketId}/no-show`, {}, op)).status).toBe(200);
    } finally {
      await sqlOne(app, 'UPDATE trips SET departs_at = $2, arrives_at = $3 WHERE id = $1', [
        f.tripId,
        was.d,
        was.a,
      ]);
      if (policy.isCustom) await app.patch('/operator/refund-policy', policy.policy, op);
      else await app.post('/operator/refund-policy/reset', {}, op);
    }
  });

  it("an expense receipt goes on this operator's trip only, then on the expense", async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const raw = {
      headers: {
        authorization: `Bearer ${app.fixtures.operatorToken}`,
        'x-tenant-slug': app.fixtures.tenantSlug,
        'content-type': 'application/octet-stream',
      },
    };
    const unknown = '01a0dddd-0000-7000-8000-000000000000';
    expect(
      (await app.post(`/trips/${unknown}/expenses/receipt?fileName=r.png`, png, raw)).status,
    ).toBe(404);
    const up = await app.post(
      `/trips/${app.fixtures.tripId}/expenses/receipt?fileName=r.png`,
      png,
      raw,
    );
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const added = await app.post(
      `/trips/${app.fixtures.tripId}/expenses`,
      { category: 'toll', amountMinor: 45_000, note: 'Toll plaza', receiptFileId: up.body.fileId },
      { as: 'operator', idempotencyKey: `e2e-receipt-${Date.now()}` },
    );
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const list = await app.get(`/trips/${app.fixtures.tripId}/expenses`, { as: 'operator' });
    expect(list.body.items.find((x: { id: string }) => x.id === added.body.id)).toMatchObject({
      receiptFileId: up.body.fileId,
    });
  });

  it('waitlist: staff see who is waiting and can take someone off (their phone must match)', async () => {
    const f = app.fixtures;
    const phone = `98${String(Date.now()).slice(-8)}`;
    const id = await sqlOne<{ id: string }>(
      app,
      `INSERT INTO trip_waitlist (tenant_id, trip_id, from_stop_id, to_stop_id, from_seq, to_seq, seat_count, contact_phone)
       SELECT t.tenant_id, t.id, $2, $3,
              (SELECT sequence FROM route_stops WHERE route_id = t.route_id AND stop_id = $2),
              (SELECT sequence FROM route_stops WHERE route_id = t.route_id AND stop_id = $3), 2, $4
         FROM trips t WHERE t.id = $1 RETURNING id`,
      [f.tripId, f.fromStopId, f.toStopId, phone],
    );
    const list = await app.get(`/trips/${f.tripId}/waitlist`, op);
    expect(list.status).toBe(200);
    expect(list.body.items.find((w: { id: string }) => w.id === id.id)).toMatchObject({
      status: 'waiting',
      seatCount: 2,
    });
    const leave = (p: string) =>
      app.post(`/trips/${f.tripId}/waitlist/${id.id}/leave`, { contactPhone: p }, op);
    expect((await leave('9000000000')).status).toBe(404);
    expect((await leave(phone)).status).toBe(200);
    expect((await leave(phone)).status).toBe(404);
  });
});
