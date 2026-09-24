import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';
import {
  createContext,
  newId,
  runAsTenant,
  runWithContext,
  type LocalDate,
  type TenantId,
} from '@kernel';

import { SettlementService } from '@api/modules/payment/application/services/settlement.service';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Settlement netting of one-time platform charges. When the charges exceed
 * what a period earned, the uncovered part must be carried into the next
 * settlement as a 'settlement_shortfall' charge — never written off.
 */
describe('settlement (e2e)', () => {
  let app: TestApp;
  let tenantId: TenantId;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    tenantId = app.fixtures.tenantId as TenantId;
  });
  afterAll(async () => {
    await app.close();
  });

  const asOperator = <T>(fn: () => Promise<T>) =>
    runWithContext(createContext({ actorType: 'system' }), () => runAsTenant(tenantId, fn));

  const pendingCharges = () =>
    asOperator(() =>
      app.nest.get(UnitOfWork).run({ name: 'e2e.pendingCharges', readOnly: true }, async (s) => {
        const r = await s.client.query<{ n: string; total: string }>(
          `SELECT count(*) AS n, coalesce(sum(amount_minor), 0) AS total
             FROM platform_charges WHERE tenant_id = $1 AND status = 'pending'`,
          [tenantId],
        );
        return { count: Number(r.rows[0].n), totalMinor: Number(r.rows[0].total) };
      }),
    );

  it('carries charges a quiet period cannot cover into the next settlement', async () => {
    // A one-time fee of ₹50 on top of whatever is already pending.
    await asOperator(() =>
      app.nest.get(UnitOfWork).run({ name: 'e2e.charge' }, async (s) => {
        await s.client.query(
          `INSERT INTO platform_charges (id, tenant_id, kind, reference_type, reference_id, amount_minor, status, description)
           VALUES ($1, $2, 'per_bus_fee', 'e2e', $3, 5000, 'pending', 'e2e fee')`,
          [newId(), tenantId, newId()],
        );
      }),
    );
    const before = await pendingCharges();
    expect(before.totalMinor).toBeGreaterThanOrEqual(5000);

    // A past week with no ledger activity: gross 0, so nothing can be deducted.
    const day = 1 + Math.floor(Math.random() * 360);
    const from = new Date(Date.UTC(1990 + (Date.now() % 30), 0, day));
    const to = new Date(from.getTime() + 6 * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10) as LocalDate;

    const settlements = app.nest.get(SettlementService);
    const { netMinor } = await asOperator(() => settlements.runPayout(iso(from), iso(to)));
    expect(netMinor).toBe(0);

    // Every earlier charge is settled, and exactly one shortfall charge carries
    // the full amount forward.
    const after = await pendingCharges();
    expect(after.totalMinor).toBe(before.totalMinor);
    expect(after.count).toBe(1);
  });
});
