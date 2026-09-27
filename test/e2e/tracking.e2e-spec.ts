import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService, UnitOfWork } from '@database';
import { createContext, runAsTenant, runWithContext, type TenantId } from '@kernel';
import { EventBus } from '@messaging';
import { Logger } from '@observability';

import { TrackingService } from '@api/modules/tracking/application/services/tracking.service';
import { TripReminderScheduler } from '@worker/schedulers/trip-reminder.scheduler';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, sqlOne, type TripLeg } from './support/flows';

/**
 * Journey day: reminders at 8h, 4h and 1h before boarding (SMS, WhatsApp,
 * email); the 4h and 1h ones carry the tracking link and every driver (one
 * to three) and conductor with their mobile. The crew phone shares GPS only
 * from one hour before departure until the trip is over, and the passenger's
 * link says plainly when the bus is not trackable yet / any more.
 */
describe('journey reminders and the tracking window (e2e)', () => {
  let app: TestApp;
  let leg: TripLeg;
  let bookingId: string;
  let token: string;
  let cancelledToken: string;
  let cancelledId: string;
  const op = { as: 'operator' as const };
  const run = Date.now().toString().slice(-6);
  const phones = [`98${run}01`, `98${run}02`, `98${run}03`];

  const asTenant = <T>(fn: () => T): T =>
    runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, fn),
    );
  const issueToken = (id: string, pnr: string) =>
    asTenant(() =>
      app.nest
        .get(TrackingService)
        .issueTrackingToken(id, leg.tripId, pnr, new Date(Date.now() + 86_400_000)),
    );
  /** Move the test trip so it leaves `minutes` from now (arrival keeps the same run time). */
  const departsIn = (minutes: number) =>
    sqlOne(
      app,
      `UPDATE trips SET arrives_at = arrives_at - (departs_at - (now() + make_interval(mins => $2))),
                        departs_at = now() + make_interval(mins => $2)
        WHERE id = $1`,
      [leg.tripId, minutes],
    );
  const track = (t: string) => app.get(`/tracking/token/${t}`, { as: 'anonymous' });
  const ping = () =>
    app.post(
      '/tracking/ping',
      { tripId: leg.tripId, lat: 28.6667, lng: 77.2167, speedKmph: 55, distanceCoveredM: 1200 },
      op,
    );
  const reminders = () =>
    new TripReminderScheduler(
      app.nest.get(DatabaseService),
      app.nest.get(UnitOfWork),
      app.nest.get(EventBus),
      app.nest.get(TrackingService),
      app.nest.get(Logger),
    ).run();
  /** The reminder event queued for our booking at a stage (the dev worker may have sent it). */
  const reminderFor = (stage: string) =>
    sqlOne<{ payload: Record<string, unknown> } | undefined>(
      app,
      `SELECT payload FROM outbox_events
        WHERE event_type = $1 AND aggregate_id = $2 AND payload->>'pnr' =
              (SELECT pnr FROM bookings WHERE id = $3)`,
      [`trip.reminder.${stage}`, leg.tripId, bookingId],
    );
  const remindersSent = async (id: string) =>
    Number(
      (
        await sqlOne<{ n: string }>(
          app,
          `SELECT count(*) AS n FROM outbox_events
        WHERE event_type LIKE 'trip.reminder.%' AND payload->>'pnr' = (SELECT pnr FROM bookings WHERE id = $1)`,
          [id],
        )
      ).n,
    );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const f = app.fixtures;
    const routeId = (await app.get(`/scheduling/trips/${f.tripId}`, op)).body.trip.routeId;
    // A spare open trip of the fixture route that this test moves in time
    // (mid-range: trip-ops takes the earliest spare, reviews the latest).
    let spare: { id: string } | undefined;
    for (let d = 12; d <= 26 && !spare; d += 1) {
      const day = new Date(Date.parse(f.journeyDate) + d * 864e5).toISOString().slice(0, 10);
      const list = await app.get(`/scheduling/trips?date=${day}`, op);
      spare = list.body.items.find(
        (t: {
          id: string;
          status: string;
          routeId: string;
          bookedSeats: number;
          totalSeats: number;
        }) =>
          t.id !== f.tripId &&
          t.status === 'open' &&
          t.routeId === routeId &&
          t.bookedSeats < t.totalSeats - 4,
      );
    }
    expect(spare, 'an open trip of the fixture route with free seats').toBeDefined();
    const chart = (await app.get(`/bookings/trips/${spare!.id}/chart`, op)).body;
    leg = {
      tripId: spare!.id,
      fromStopId: chart.stops[0].stopId,
      toStopId: chart.stops[chart.stops.length - 1].stopId,
    };
    const map = await app.get(
      `/scheduling/trips/${leg.tripId}/availability?from=${leg.fromStopId}&to=${leg.toStopId}`,
      { as: 'anonymous' },
    );
    const free = (
      map.body.seats as {
        seatNumber: string;
        available: boolean;
        ladiesOnly: boolean;
        accessible: boolean;
        reservedFor: string | null;
        seatType: string;
      }[]
    )
      .filter(
        (x) =>
          x.available &&
          x.seatType === 'seater' &&
          !x.ladiesOnly &&
          !x.accessible &&
          !x.reservedFor,
      )
      .map((x) => x.seatNumber);

    const booked = await confirmedBooking(
      app,
      free[0],
      { fullName: 'Tracked Traveller', age: 33 },
      leg,
    );
    bookingId = booked.bookingId;
    token = issueToken(booked.bookingId, booked.pnr);

    const gone = await confirmedBooking(app, free[1], { fullName: 'Changed Plans', age: 40 }, leg);
    const cancel = await app.post(
      `/bookings/${gone.bookingId}/cancel`,
      { reason: 'Plans changed' },
      { ...op, idempotencyKey: `e2e-track-cx-${run}` },
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    cancelledToken = issueToken(gone.bookingId, gone.pnr);
    cancelledId = gone.bookingId;

    // Two drivers taking turns and a conductor on this bus.
    const trip = (await app.get(`/scheduling/trips/${leg.tripId}`, op)).body.trip as {
      departsAt: string;
      arrivesAt: string;
    };
    const staff: [string, string][] = [
      ['driver', `Driver One ${run}`],
      ['driver', `Driver Two ${run}`],
      ['conductor', `Conductor ${run}`],
    ];
    for (const [i, [role, fullName]] of staff.entries()) {
      const licence =
        role === 'driver' ? { licenceNo: `DL${run}${i}0001`, licenceExpiresOn: '2030-12-31' } : {};
      const made = await app.post(
        '/fleet/crew',
        { role, fullName, phone: phones[i], ...licence },
        op,
      );
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const duty = await app.post(
        '/fleet/crew/duties',
        {
          crewId: made.body.id,
          tripId: leg.tripId,
          startsAt: new Date(Date.parse(trip.departsAt) - 30 * 60_000).toISOString(),
          endsAt: trip.arrivesAt,
          drivingMinutes: 0,
        },
        op,
      );
      expect(duty.status, JSON.stringify(duty.body)).toBe(201);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('days before: the link says when tracking starts and who the crew are; no GPS is taken', async () => {
    const r = await track(token);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.phase).toBe('too_early');
    expect(r.body.message).toMatch(/Live tracking starts at .*one hour before your bus leaves at/);
    expect(r.body.lat).toBeNull();
    expect(r.body.recentPings).toEqual([]);
    expect(r.body.crew.map((c: { role: string }) => c.role)).toEqual([
      'driver',
      'driver',
      'conductor',
    ]);
    expect(r.body.crew[0].phone).toBe(phones[0]);

    const p = await ping();
    expect(p.status).toBe(422);
    expect(p.body.detail).toMatch(/GPS sharing starts at/);
  });

  it('a cancelled booking and a forged link get a clear answer', async () => {
    const c = await track(cancelledToken);
    expect(c.status).toBe(200);
    expect(c.body.phase).toBe('booking_cancelled');
    expect(c.body.crew).toEqual([]);
    expect(c.body.message).toMatch(/booking was cancelled/);
    const [body] = token.split('.');
    expect((await track(`${body}.forged`)).status).toBe(403);
    expect((await track('not-a-token')).status).toBe(400);
  });

  it('8h before boarding: the trip reminder, once, without a tracking link', async () => {
    await departsIn(8 * 60);
    await reminders();
    await reminders(); // a second sweep never sends it again
    const r = await reminderFor('8h');
    expect(r, 'the 8h reminder').toBeDefined();
    expect(r!.payload).toMatchObject({ stage: '8h', contactPhone: expect.any(String) });
    expect(r!.payload.trackingUrl).toBeUndefined();
    expect(String(r!.payload.boardingAt)).toMatch(/(am|pm)$/);
    expect(await remindersSent(bookingId)).toBe(1);
  });

  it('4h before: pickup, bus, every driver and the conductor with mobiles, and the tracking link', async () => {
    await departsIn(4 * 60);
    await reminders();
    const r = await reminderFor('4h');
    expect(r, 'the 4h reminder').toBeDefined();
    const p = r!.payload;
    expect(p.trackingUrl).toMatch(/\/track\//);
    expect(p.driversList).toBe(
      `Driver One ${run} (${phones[0]}), Driver Two ${run} (${phones[1]})`,
    );
    expect(p.attendantsList).toBe(`Conductor ${run} (${phones[2]})`);
    expect(p.crewList).toBe(
      `Driver 1: Driver One ${run} (${phones[0]})\nDriver 2: Driver Two ${run} (${phones[1]})\nConductor: Conductor ${run} (${phones[2]})`,
    );
    expect(p.drivers).toHaveLength(2);

    // Two hours before: still too early to see the bus.
    await departsIn(2 * 60);
    const early = await track(token);
    expect(early.body.phase).toBe('too_early');
    expect((await ping()).status).toBe(422);
  });

  it('1h before: the last reminder, and the bus is live on the map', async () => {
    await departsIn(60);
    await reminders();
    const r = await reminderFor('1h');
    expect(r, 'the 1h reminder').toBeDefined();
    expect(r!.payload.trackingUrl).toMatch(/\/track\//);
    expect(r!.payload.driversList).toContain(phones[1]);
    expect(await remindersSent(bookingId)).toBe(3);

    await departsIn(50);
    const p = await ping();
    expect(p.status, JSON.stringify(p.body)).toBe(202);
    const live = await track(token);
    expect(live.body.phase).toBe('live');
    // Parked at the boarding point before its time: not "late".
    expect(live.body.delayMinutes).toBe(0);
    expect(live.body.status).toBe('running');
    expect(live.body.lat).toBeCloseTo(28.6667);
    expect(live.body.recentPings.length).toBeGreaterThan(0);
    expect(live.body.crew).toHaveLength(3);
    expect(live.body.fromStopName).not.toBe('Boarding point');
  });

  it('a cancelled booking is never reminded', async () => {
    expect(await remindersSent(cancelledId)).toBe(0);
  });

  it('after the journey: tracking and GPS stop, with the time it ended', async () => {
    await departsIn(10);
    expect(
      (await app.post(`/crew/trips/${leg.tripId}/status`, { status: 'departed' }, op)).status,
    ).toBe(201);
    expect((await ping()).status).toBe(202);
    // Running far behind: passengers get ONE delay alert, not one per ping.
    await departsIn(-180);
    await sqlOne(
      app,
      `UPDATE trip_stops ts SET departs_at = t.departs_at + (rs.depart_offset_min || ' minutes')::interval
         FROM trips t JOIN route_stops rs ON rs.route_id = t.route_id
        WHERE ts.trip_id = t.id AND rs.sequence = ts.sequence AND t.id = $1`,
      [leg.tripId],
    );
    expect((await ping()).status).toBe(202);
    expect((await ping()).status).toBe(202);
    const alerts = await sqlOne<{ n: string; delay: string | null }>(
      app,
      `SELECT count(*) AS n, max(payload->>'delayMinutes') AS delay FROM outbox_events
        WHERE event_type = 'trip.delayed' AND aggregate_id = $1`,
      [leg.tripId],
    );
    expect(Number(alerts.n)).toBe(1);
    expect(Number(alerts.delay)).toBeGreaterThan(15);
    expect(
      (await app.post(`/crew/trips/${leg.tripId}/status`, { status: 'closed' }, op)).status,
    ).toBe(201);
    const over = await track(token);
    expect(over.body.phase).toBe('ended');
    expect(over.body.message).toMatch(/This journey ended at .*Live tracking is closed/);
    expect(over.body.lat).toBeNull();
    expect(over.body.crew).toEqual([]);
    const p = await ping();
    expect(p.status).toBe(422);
    expect(p.body.detail).toMatch(/ended/);
  });

  it('the fleet view lists only buses on the road, for staff only', async () => {
    const r = await app.get('/tracking/fleet', op);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect((await app.get('/tracking/fleet', { as: 'anonymous' })).status).toBe(401);
    expect((await app.get('/tracking/fleet', { as: 'customer' })).status).toBe(403);
  });
});
