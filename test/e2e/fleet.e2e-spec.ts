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
});
