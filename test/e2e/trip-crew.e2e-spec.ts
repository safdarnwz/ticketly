import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService, UnitOfWork } from '@database';
import {
  createContext,
  runAsTenant,
  runWithContext,
  type DomainEvent,
  type TenantId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger } from '@observability';

import { NotificationService } from '@api/modules/notification/application/services/notification.service';
import { TrackingService } from '@api/modules/tracking/application/services/tracking.service';
import { NotificationConsumer } from '@worker/consumers/notification.consumer';
import { type EventDispatcher } from '@worker/dispatcher/event-dispatcher';
import { JourneyDetailsService } from '@worker/schedulers/journey-details.service';
import { TripReminderScheduler } from '@worker/schedulers/trip-reminder.scheduler';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking, sqlOne, type TripLeg } from './support/flows';

/**
 * The trip decides who runs it: any verified bus of the operator (whatever
 * route it usually runs) and its crew — one to three drivers and the
 * conductor. Passengers already given those details in the 4-hour reminder
 * are sent the new bus / crew once when it changes; nobody else is.
 */
describe('the trip decides its bus and crew; late changes reach passengers (e2e)', () => {
  let app: TestApp;
  let leg: TripLeg;
  let told: { bookingId: string; pnr: string };
  let notTold: { bookingId: string; pnr: string };
  const op = { as: 'operator' as const };
  const run = Date.now().toString().slice(-6);
  const crewIds: Record<string, string> = {};
  const dutyIds: Record<string, string> = {};
  let trip: { departsAt: string; arrivesAt: string; seatLayoutId?: string };

  const journeys = () =>
    new JourneyDetailsService(app.nest.get(DatabaseService), app.nest.get(TrackingService));
  /** The worker's handler for bus / crew changes, run on the event just written. */
  const deliver = async (type: string, eventId?: string) => {
    const row = await sqlOne<{
      id: string;
      tenant_id: string;
      aggregate_id: string;
      payload: unknown;
    }>(
      app,
      `SELECT id, tenant_id, aggregate_id, payload FROM outbox_events
        WHERE event_type = $1 AND aggregate_id = $2 ORDER BY occurred_at DESC LIMIT 1`,
      [type, leg.tripId],
    );
    expect(row, `a ${type} event`).toBeDefined();
    const consumer = new NotificationConsumer(
      { register: () => undefined } as unknown as EventDispatcher,
      app.nest.get(NotificationService),
      app.nest.get(DatabaseService),
      journeys(),
    );
    const event = {
      eventId: eventId ?? row.id,
      type,
      version: 1,
      occurredAt: new Date(),
      tenantId: row.tenant_id as TenantId,
      aggregateType: 'trip',
      aggregateId: row.aggregate_id,
      payload: row.payload,
    } as DomainEvent;
    await (
      consumer as unknown as {
        detailsChangedHandler(t: string): { handle(e: DomainEvent): Promise<void> };
      }
    )
      .detailsChangedHandler(type)
      .handle(event);
    return event.eventId;
  };
  const notices = (eventId: string, pnr: string) =>
    sqlOne<{ n: string; body: string | null }>(
      app,
      `SELECT count(*) AS n, max(body) FILTER (WHERE channel = 'sms') AS body FROM notifications
        WHERE event_id = $1 AND body LIKE '%' || $2 || '%'`,
      [eventId, pnr],
    );
  const addCrew = async (key: string, role: string, i: number) => {
    const licence =
      role === 'driver' ? { licenceNo: `DL${run}${i}0002`, licenceExpiresOn: '2031-12-31' } : {};
    const made = await app.post(
      '/fleet/crew',
      {
        role,
        fullName: `${key} ${run}`,
        phone: `97${run}${String(i).padStart(2, '0')}`,
        ...licence,
      },
      op,
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    crewIds[key] = made.body.id;
  };
  const assign = (key: string, drivingMinutes = 0) =>
    app.post(
      '/fleet/crew/duties',
      {
        crewId: crewIds[key],
        tripId: leg.tripId,
        startsAt: new Date(Date.parse(trip.departsAt) - 30 * 60_000).toISOString(),
        endsAt: trip.arrivesAt,
        drivingMinutes,
      },
      op,
    );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const f = app.fixtures;
    const routeId = (await app.get(`/scheduling/trips/${f.tripId}`, op)).body.trip.routeId;
    // An open trip of the fixture route, a week or more out, with no crew yet
    // (each run uses one up; the latest first — other suites take the earliest).
    const spare = await sqlOne<{ id: string } | undefined>(
      app,
      `SELECT t.id FROM trips t
        WHERE t.route_id = $1 AND t.id <> $2 AND t.status = 'open' AND t.journey_date > current_date + 6
          AND NOT EXISTS (SELECT 1 FROM crew_duties d WHERE d.trip_id = t.id)
          AND (SELECT count(*) FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                WHERE bs.trip_id = t.id AND b.status IN ('held', 'confirmed')) < 10
        ORDER BY t.journey_date DESC LIMIT 1`,
      [routeId, f.tripId],
    );
    expect(spare, 'an open trip of the fixture route without crew').toBeDefined();
    const chart = (await app.get(`/bookings/trips/${spare!.id}/chart`, op)).body;
    leg = {
      tripId: spare!.id,
      fromStopId: chart.stops[0].stopId,
      toStopId: chart.stops[chart.stops.length - 1].stopId,
    };
    trip = (await app.get(`/scheduling/trips/${leg.tripId}`, op)).body.trip;
    const map = await app.get(
      `/scheduling/trips/${leg.tripId}/availability?from=${leg.fromStopId}&to=${leg.toStopId}`,
      { as: 'anonymous' },
    );
    const free = (
      map.body.seats as {
        seatNumber: string;
        available: boolean;
        seatType: string;
        ladiesOnly: boolean;
        accessible: boolean;
        reservedFor: string | null;
      }[]
    )
      .filter(
        (s) =>
          s.available &&
          s.seatType === 'seater' &&
          !s.ladiesOnly &&
          !s.accessible &&
          !s.reservedFor,
      )
      .map((s) => s.seatNumber);
    told = await confirmedBooking(app, free[0], { fullName: 'Told Traveller', age: 36 }, leg);
    for (const [i, [key, role]] of (
      [
        ['D1', 'driver'],
        ['D2', 'driver'],
        ['D3', 'driver'],
        ['D4', 'driver'],
        ['C1', 'conductor'],
      ] as const
    ).entries())
      await addCrew(key, role, i);
  });
  afterAll(async () => {
    await app.close();
  });

  it('one to three drivers and a conductor per trip; the trip lists them with their mobiles', async () => {
    for (const k of ['D1', 'D2', 'D3']) {
      const r = await assign(k, 120);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      dutyIds[k] = r.body.id;
    }
    const fourth = await assign('D4', 60);
    expect(fourth.status).toBe(422);
    expect(fourth.body.detail).toMatch(/already has 3 drivers/);
    const c = await assign('C1');
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    dutyIds.C1 = c.body.id;

    const list = await app.get(`/fleet/crew/duties?tripId=${leg.tripId}`, op);
    expect(list.status).toBe(200);
    expect(list.body.duties.map((d: { crewRole: string }) => d.crewRole)).toEqual([
      'driver',
      'driver',
      'driver',
      'conductor',
    ]);
    expect(list.body.duties[0].crewPhone).toMatch(/^97/);
    expect((await app.get(`/fleet/crew/duties?tripId=not-a-uuid`, op)).status).toBe(400);
    expect(
      (await app.get(`/fleet/crew/duties?tripId=${leg.tripId}`, { as: 'customer' })).status,
    ).toBe(403);
  });

  it('the 4-hour reminder tells a passenger the bus crew; a later change reaches only them, once', async () => {
    await sqlOne(
      app,
      `UPDATE trips SET arrives_at = arrives_at - (departs_at - (now() + interval '4 hours')), departs_at = now() + interval '4 hours' WHERE id = $1`,
      [leg.tripId],
    );
    await new TripReminderScheduler(
      app.nest.get(UnitOfWork),
      app.nest.get(EventBus),
      journeys(),
      app.nest.get(Logger),
    ).run();
    const hash = await sqlOne<{
      journey_details_hash: string | null;
      reminder_4h_sent_at: Date | null;
    }>(app, 'SELECT journey_details_hash, reminder_4h_sent_at FROM bookings WHERE id = $1', [
      told.bookingId,
    ]);
    expect(hash.reminder_4h_sent_at).not.toBeNull();
    expect(hash.journey_details_hash).toMatch(/^[0-9a-f]{32}$/);

    // Booked after the 4-hour reminder went out: will simply get the 1-hour one.
    const seat = (
      await app.get(
        `/scheduling/trips/${leg.tripId}/availability?from=${leg.fromStopId}&to=${leg.toStopId}`,
        { as: 'anonymous' },
      )
    ).body.seats.find(
      (s: {
        available: boolean;
        seatType: string;
        ladiesOnly: boolean;
        accessible: boolean;
        reservedFor: string | null;
      }) =>
        s.available && s.seatType === 'seater' && !s.ladiesOnly && !s.accessible && !s.reservedFor,
    ).seatNumber;
    notTold = await confirmedBooking(app, seat, { fullName: 'Late Booker', age: 29 }, leg);

    // Driver 2 is taken off.
    expect((await app.post(`/fleet/crew/duties/${dutyIds.D2}/cancel`, {}, op)).status).toBe(201);
    const ev = await deliver('trip.crew_changed');
    const sent = await notices(ev, told.pnr);
    expect(Number(sent.n)).toBeGreaterThanOrEqual(2); // SMS + WhatsApp (+ email when given)
    expect(sent.body).toContain('crew of your bus has changed');
    expect(sent.body).toContain(`D1 ${run}`);
    expect(sent.body).not.toContain(`D2 ${run}`);
    expect(Number((await notices(ev, notTold.pnr)).n)).toBe(0);

    // The same details again (another event, nothing changed): not re-sent.
    const again = await deliver('trip.crew_changed', randomUUID());
    expect(Number((await notices(again, told.pnr)).n)).toBe(0);
  });

  it('another bus takes the trip (any verified bus, any route): passengers told get the new bus number', async () => {
    const { seat_layout_id: layoutId, vehicle_type_id: typeId } = await sqlOne<{
      seat_layout_id: string;
      vehicle_type_id: string;
    }>(
      app,
      `SELECT t.seat_layout_id, (SELECT id FROM vehicle_types WHERE tenant_id = t.tenant_id LIMIT 1) AS vehicle_type_id FROM trips t WHERE t.id = $1`,
      [leg.tripId],
    );
    const reg = `RJ${run.slice(0, 2)}ZX${run.slice(2)}`;
    const bus = await sqlOne<{ id: string }>(
      app,
      `INSERT INTO vehicles (tenant_id, registration_no, vehicle_type_id, seat_layout_id, status, verification_status)
       SELECT tenant_id, $1, $2, $3, 'active', 'approved' FROM trips WHERE id = $4 RETURNING id`,
      [reg, typeId, layoutId, leg.tripId],
    );
    for (const doc of ['permit', 'insurance', 'fitness', 'puc'])
      await sqlOne(
        app,
        `INSERT INTO vehicle_documents (tenant_id, vehicle_id, doc_type, document_no, valid_from, expires_on, verification_status)
         SELECT tenant_id, $1, $2, $3, '2025-01-01', '2031-12-31', 'verified' FROM vehicles WHERE id = $1`,
        [bus.id, doc, `${doc.toUpperCase()}-${run}`],
      );

    const change = await app.post(
      `/trips/${leg.tripId}/vehicle`,
      { vehicleId: bus.id, reason: 'Regular bus broke down at the depot' },
      { ...op, idempotencyKey: `e2e-bus-${run}` },
    );
    expect(change.status, JSON.stringify(change.body)).toBeLessThan(300);
    expect(change.body).toMatchObject({ changed: true, layoutChanged: false });
    const ev = await deliver('trip.vehicle_changed');
    const sent = await notices(ev, told.pnr);
    expect(sent.body).toContain(reg);
    expect(sent.body).toContain('Your bus has changed (Regular bus broke down at the depot)');
    expect(Number((await notices(ev, notTold.pnr)).n)).toBe(0);
    // The reminders read the trip's bus from now on too.
    const next = await runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, () =>
        journeys().boarding(told.bookingId, '1h'),
      ),
    );
    expect(next?.busNumber).toBe(reg);
  });

  it('a trip that has run takes no crew', async () => {
    await sqlOne(
      app,
      `UPDATE trips SET departs_at = now() + interval '10 minutes', arrives_at = now() + interval '5 hours' WHERE id = $1`,
      [leg.tripId],
    );
    expect(
      (await app.post(`/crew/trips/${leg.tripId}/status`, { status: 'departed' }, op)).status,
    ).toBe(201);
    expect(
      (await app.post(`/crew/trips/${leg.tripId}/status`, { status: 'closed' }, op)).status,
    ).toBe(201);
    const late = await assign('D4', 60);
    expect(late.status).toBe(422);
    expect(late.body.detail).toMatch(/trip is over/);
  });
});
