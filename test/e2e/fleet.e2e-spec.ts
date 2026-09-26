import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';
import { createContext, runAsTenant, runWithContext, type TenantId } from '@kernel';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/** Adding a bus registers it as a draft and charges the one-time per-bus fee, once. */
describe('fleet (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const busFeeCharges = (vehicleId: string) =>
    runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, () =>
        app.nest.get(UnitOfWork).run({ name: 'e2e.busFee', readOnly: true }, async (s) => {
          const r = await s.client.query<{ amount_minor: string }>(
            `SELECT amount_minor FROM platform_charges
              WHERE kind = 'per_bus_fee' AND reference_type = 'vehicle' AND reference_id = $1`,
            [vehicleId],
          );
          return r.rows.map((x) => Number(x.amount_minor));
        }),
      ),
    );

  it('adds a draft bus and charges the per-bus fee once', async () => {
    const types = await app.get('/master-data/vehicle-types', { as: 'operator' });
    expect(types.status).toBe(200);
    const vehicleTypeId: string = (types.body.items ?? types.body)[0].id;
    // A fresh, valid Indian registration number (e.g. DL04KX1234) per run.
    const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
    const digits = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
    const registrationNo = `DL${digits(2)}${letter()}${letter()}${digits(4)}`;

    const res = await app.post(
      '/fleet/vehicles',
      { registrationNo, vehicleTypeId },
      { as: 'operator', idempotencyKey: `e2e-bus-${registrationNo}` },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.verificationStatus).toBe('draft');

    const fees = await busFeeCharges(res.body.id);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toBeGreaterThan(0);

    const again = await app.post(
      '/fleet/vehicles',
      { registrationNo, vehicleTypeId },
      { as: 'operator', idempotencyKey: `e2e-bus2-${registrationNo}` },
    );
    expect(again.status).toBe(409);
  });

  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const at = (hoursAhead: number) => new Date(Date.now() + hoursAhead * 3_600_000).toISOString();
  const unknownId = '01a0dddd-0000-7000-8000-000000000000';

  it("maintenance: done work only, next due after it, this operator's bus only", async () => {
    const list = await app.get('/fleet/vehicles', { as: 'operator' });
    const vehicleId: string = (list.body.items ?? list.body)[0].id;
    const log = (body: Record<string, unknown>, id = vehicleId) =>
      app.post(`/fleet/vehicles/${id}/maintenance`, body, { as: 'operator' });
    const good = {
      kind: 'service',
      description: 'Oil and filter change',
      performedOn: day(-1),
      costMinor: 250000,
    };

    expect((await log({ ...good, description: '  ' })).status).toBe(400);
    expect((await log({ ...good, performedOn: day(3) })).status).toBe(422);
    expect((await log({ ...good, nextDueOn: day(-2) })).status).toBe(400);
    expect((await log({ ...good, costMinor: -1 })).status).toBe(400);
    expect((await log(good, unknownId)).status).toBe(404);
    expect(
      (await app.get(`/fleet/vehicles/${unknownId}/maintenance`, { as: 'operator' })).status,
    ).toBe(404);

    const ok = await log({ ...good, nextDueOn: day(90), odometerKm: 120000 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const history = await app.get(`/fleet/vehicles/${vehicleId}/maintenance`, { as: 'operator' });
    expect(
      history.body.items.some(
        (m: { description: string }) => m.description === 'Oil and filter change',
      ),
    ).toBe(true);
  });

  it('crew: driver needs a licence, one mobile per person, leave refused while holding duties', async () => {
    const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const noLicence = await app.post(
      '/fleet/crew',
      { role: 'driver', fullName: 'Ravi Driver' },
      { as: 'operator' },
    );
    expect(noLicence.status).toBe(400);
    const created = await app.post(
      '/fleet/crew',
      {
        role: 'driver',
        fullName: 'Ravi Driver',
        phone,
        licenceNo: 'rj14 2019 0001234',
        licenceExpiresOn: day(20),
      },
      { as: 'operator' },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const crewId: string = created.body.id;
    const samePhone = await app.post(
      '/fleet/crew',
      { role: 'conductor', fullName: 'Other', phone },
      { as: 'operator' },
    );
    expect(samePhone.status).toBe(409);

    // Duties: past ones, unknown crew / trip, a licence that ends before the duty.
    const duty = (body: Record<string, unknown>) =>
      app.post('/fleet/crew/duties', { crewId, drivingMinutes: 60, ...body }, { as: 'operator' });
    expect((await duty({ startsAt: at(-50), endsAt: at(-48) })).status).toBe(400);
    expect((await duty({ crewId: unknownId, startsAt: at(24), endsAt: at(26) })).status).toBe(404);
    expect((await duty({ tripId: unknownId, startsAt: at(24), endsAt: at(26) })).status).toBe(404);
    expect((await duty({ startsAt: at(24 * 25), endsAt: at(24 * 25 + 2) })).status).toBe(422);
    const assigned = await duty({ startsAt: at(24), endsAt: at(26) });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);

    const crew = await app.get('/fleet/crew?role=driver', { as: 'operator' });
    const me = crew.body.items.find((c: { id: string }) => c.id === crewId);
    expect(me).toMatchObject({ licenceNo: 'RJ1420190001234', upcomingDuties: 1, phone });

    // The day's attendance sheet (operator's day) lists it; another day or a bad date does not.
    const istDay = new Date(Date.parse(at(24)) + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const sheet = await app.get(`/fleet/crew/duties?date=${istDay}`, { as: 'operator' });
    expect(sheet.status).toBe(200);
    expect(sheet.body.duties.find((d: { id: string }) => d.id === assigned.body.id)).toMatchObject({
      crewId,
      attendance: 'pending',
    });
    const empty = await app.get('/fleet/crew/duties?date=1990-01-01', { as: 'operator' });
    expect(empty.body.duties).toEqual([]);
    expect((await app.get('/fleet/crew/duties?date=26-09-2026', { as: 'operator' })).status).toBe(
      400,
    );

    const leave = await app.patch(
      `/fleet/crew/${crewId}`,
      { status: 'on_leave' },
      { as: 'operator' },
    );
    expect(leave.status).toBe(422);
    expect(
      (await app.patch(`/fleet/crew/${crewId}`, { licenceNo: null }, { as: 'operator' })).status,
    ).toBe(422);
    expect((await app.patch(`/fleet/crew/${crewId}`, {}, { as: 'operator' })).status).toBe(400);
    expect(
      (await app.patch(`/fleet/crew/${unknownId}`, { fullName: 'X Y' }, { as: 'operator' })).status,
    ).toBe(404);

    // Cancel is idempotent; then leave is allowed and a new duty is refused.
    const dutyId: string = assigned.body.id;
    expect(
      (await app.post(`/fleet/crew/duties/${dutyId}/cancel`, {}, { as: 'operator' })).status,
    ).toBe(201);
    expect(
      (await app.post(`/fleet/crew/duties/${dutyId}/cancel`, {}, { as: 'operator' })).status,
    ).toBe(201);
    expect(
      (await app.post(`/fleet/crew/duties/${unknownId}/cancel`, {}, { as: 'operator' })).status,
    ).toBe(404);
    const onLeave = await app.patch(
      `/fleet/crew/${crewId}`,
      { status: 'on_leave' },
      { as: 'operator' },
    );
    expect(onLeave.status, JSON.stringify(onLeave.body)).toBe(200);
    expect(onLeave.body).toMatchObject({ status: 'on_leave', upcomingDuties: 0 });
    expect((await duty({ startsAt: at(30), endsAt: at(32) })).status).toBe(422);
    expect((await app.get(`/fleet/crew/${unknownId}/allowance`, { as: 'operator' })).status).toBe(
      404,
    );
  });

  it('renewals: documents and driver licences due within the window, bounded', async () => {
    expect((await app.get('/fleet/expiring?days=0', { as: 'operator' })).status).toBe(400);
    expect((await app.get('/fleet/expiring?days=400', { as: 'operator' })).status).toBe(400);
    const r = await app.get('/fleet/expiring?days=365', { as: 'operator' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.days).toBe(365);
    for (const d of r.body.documents) expect(d.daysLeft).toBeLessThanOrEqual(365);
    for (const l of r.body.licences) expect(l.daysLeft === null || l.daysLeft <= 365).toBe(true);
    expect((await app.get('/fleet/expiring', { as: 'customer' })).status).toBe(403);
  });
});
