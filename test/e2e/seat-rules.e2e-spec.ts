import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Seat and sales rules on a real hold (#141 / #294 accessible seats, #421
 * ladies-seat override, #170 OTA release, #173 women quota). Each case sets
 * its rule up on the fixture trip and puts it back afterwards.
 */
describe('seat and sales rules (e2e)', () => {
  let app: TestApp;
  let serviceId: string;
  /** Free seats of the fixture trip that no other spec uses (those take fixtures.seatNumbers). */
  let seats: string[];

  const sql = async (text: string, params: unknown[]) =>
    app.nest
      .get(UnitOfWork)
      .run({ name: 'e2e.sql', bypassRls: true }, (s) => s.client.query(text, params));

  const quote = async (seat: string) => {
    const f = app.fixtures;
    const q = await app.post('/pricing/quote', {
      tripId: f.tripId,
      fromStopId: f.fromStopId,
      toStopId: f.toStopId,
      seatType: 'seater',
      seatNumbers: [seat],
    });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    return q.body.quoteId as string;
  };

  const hold = async (
    seat: string,
    passenger: Record<string, unknown>,
    extra: Record<string, unknown> = {},
    as: 'customer' | 'operator' = 'customer',
  ) =>
    app.post(
      '/bookings/hold',
      {
        quoteId: await quote(seat),
        seatNumbers: [seat],
        passengers: [{ seatNumber: seat, fullName: 'Rule Test', age: 35, ...passenger }],
        contactPhone: app.fixtures.customer.phone,
        ...extra,
      },
      { as, idempotencyKey: `e2e-rules-${seat}-${Date.now()}-${Math.random()}` },
    );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const r = await sql(`SELECT service_id FROM trips WHERE id = $1`, [app.fixtures.tripId]);
    serviceId = r.rows[0].service_id;
    const free = await sql(
      `SELECT seat_number FROM trip_seats ts
        WHERE trip_id = $1 AND is_bookable AND NOT ladies_only AND NOT accessible
          AND occupied_legs = 0 AND blocked_legs = 0 AND seat_number <> ALL($2)
          AND NOT EXISTS (SELECT 1 FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
                           WHERE bs.trip_id = ts.trip_id AND bs.seat_number = ts.seat_number
                             AND b.status = 'held' AND b.hold_expires_at > now())
        ORDER BY seat_number DESC LIMIT 5`,
      [app.fixtures.tripId, app.fixtures.seatNumbers],
    );
    seats = free.rows.map((x: { seat_number: string }) => x.seat_number);
    expect(seats).toHaveLength(5);
  });
  afterAll(async () => {
    await sql(
      `UPDATE trip_seats SET accessible = false, ladies_only = false WHERE trip_id = $1 AND seat_number = ANY($2)`,
      [app.fixtures.tripId, seats],
    );
    await sql(`UPDATE services SET sales_rules = '{}' WHERE id = $1`, [serviceId]);
    await app.put('/concessions/accessible-seats', { releaseHours: 24 }, { as: 'operator' });
    await app.close();
  });

  it('keeps an accessible seat for a disabled passenger until the release time', async () => {
    const seat = seats[0];
    await sql(`UPDATE trip_seats SET accessible = true WHERE trip_id = $1 AND seat_number = $2`, [
      app.fixtures.tripId,
      seat,
    ]);
    const refused = await hold(seat, { gender: 'male' });
    expect(refused.status).toBe(422);
    expect(refused.body.detail).toMatch(/disability/);

    // Released 720 h (30 days) before departure: the fixture trip is at most 12 days out.
    expect(
      (await app.put('/concessions/accessible-seats', { releaseHours: 720 }, { as: 'operator' }))
        .status,
    ).toBe(200);
    expect((await hold(seat, { gender: 'male' })).status).toBe(201);
  });

  it('lets only staff put a man on a ladies-only seat, with a reason', async () => {
    const seat = seats[1];
    await sql(`UPDATE trip_seats SET ladies_only = true WHERE trip_id = $1 AND seat_number = $2`, [
      app.fixtures.tripId,
      seat,
    ]);
    expect((await hold(seat, { gender: 'male' }, {}, 'operator')).status).toBe(422);
    const customer = await hold(
      seat,
      { gender: 'male' },
      { ladiesSeatOverrideReason: 'Family together' },
    );
    expect(customer.status).toBe(403);
    const staff = await hold(
      seat,
      { gender: 'male' },
      { ladiesSeatOverrideReason: 'Husband travelling with wife on seat next to it' },
      'operator',
    );
    expect(staff.status, JSON.stringify(staff.body)).toBe(201);
  });

  it('an OTA release cap does not stop the website', async () => {
    const seat = seats[2];
    const set = await app.put(
      `/scheduling/services/${serviceId}/sales-rules`,
      { otaReleasePct: 0 },
      { as: 'operator' },
    );
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    // The website keeps selling; the OTA cap itself is covered by the sales-rules
    // unit tests (a partner books through the GDS API with its own channel).
    expect((await hold(seat, { gender: 'male' })).status).toBe(201);
  });

  it('a guest cannot claim the OTA or back-office channel', async () => {
    const ota = await hold(seats[4], { gender: 'male' }, { channel: 'ota' });
    expect(ota.status).toBe(403);
    const backoffice = await hold(seats[4], { gender: 'male' }, { channel: 'backoffice' });
    expect(backoffice.status).toBe(403);
  });

  it('keeps seats for women until release; women may still take them', async () => {
    const seat = seats[3];
    const set = await app.put(
      `/scheduling/services/${serviceId}/sales-rules`,
      { categoryQuotas: { female: { pct: 100, releaseHours: 1 } } },
      { as: 'operator' },
    );
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const man = await hold(seat, { gender: 'male' });
    expect(man.status).toBe(422);
    expect(man.body.detail).toMatch(/women/);
    expect((await hold(seat, { gender: 'female' })).status).toBe(201);
  });

  it('schedule changes stay in the future and quotas fit the bus', async () => {
    const op = { as: 'operator' as const };
    const past = '2020-01-06';
    const too = await app.put(
      `/scheduling/services/${serviceId}/sales-rules`,
      { categoryQuotas: { senior: { seats: 99, releaseHours: 2 } } },
      op,
    );
    expect(too.status).toBe(422);
    expect(too.body.detail).toMatch(/only \d+ seats/);
    const svc = (await app.get('/scheduling/services', op)).body.services.find(
      (s: { id: string }) => s.id === serviceId,
    );
    const clone = await app.post(
      `/scheduling/services/${serviceId}/clone`,
      { code: `PAST-${Date.now().toString(36)}`, startDate: past, endDate: '2020-01-31' },
      { ...op, idempotencyKey: `e2e-clone-${Date.now()}` },
    );
    expect(clone.status).toBe(422);
    const edit = await app.patch(
      `/scheduling/services/${serviceId}`,
      { recurrence: { ...svc.recurrence, startDate: past, endDate: '2020-01-31' } },
      op,
    );
    expect(edit.status).toBe(422);
    const black = await app.post(
      `/scheduling/routes/${svc.routeId}/blackouts`,
      { dates: [past], reason: 'Old date' },
      op,
    );
    expect(black.status).toBe(422);
    expect(
      (await app.post(`/scheduling/services/${serviceId}/versions/999/restore`, {}, op)).status,
    ).toBe(404);
  });
});
