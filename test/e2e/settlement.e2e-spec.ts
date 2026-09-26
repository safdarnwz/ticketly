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

  const iso = (d: Date) => d.toISOString().slice(0, 10) as LocalDate;
  /** A week in the 1990s after any earlier test settlement (no ledger activity then). */
  const nextQuietWeek = () =>
    asOperator(() =>
      app.nest.get(UnitOfWork).run({ name: 'e2e.quietWeek', readOnly: true }, async (s) => {
        const r = await s.client.query<{ last: string | null }>(
          `SELECT max(period_to)::text AS last FROM settlements
            WHERE tenant_id = $1 AND period_to < '2000-01-01'`,
          [tenantId],
        );
        const last = r.rows[0].last ?? '1990-01-01';
        return new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000);
      }),
    );

  it("settling is the platform's job: a finished period, never overlapping an earlier one", async () => {
    const from = await nextQuietWeek();
    const to = new Date(from.getTime() + 6 * 86_400_000);
    const body = { tenantId, periodFrom: iso(from), periodTo: iso(to) };
    expect((await app.post('/payments/settlements', body, { as: 'operator' })).status).toBe(403);
    const admin = { as: 'platformAdmin' as const };
    const today = new Date().toISOString().slice(0, 10);
    expect(
      (
        await app.post(
          '/payments/settlements',
          { ...body, periodFrom: today, periodTo: today },
          admin,
        )
      ).status,
    ).toBe(422);
    const first = await app.post('/payments/settlements', body, admin);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await app.post('/payments/settlements', body, admin);
    expect(again.body.settlementId).toBe(first.body.settlementId); // same period: the same settlement
    const shifted = {
      ...body,
      periodFrom: iso(new Date(from.getTime() + 3 * 86_400_000)),
      periodTo: iso(new Date(to.getTime() + 3 * 86_400_000)),
    };
    expect((await app.post('/payments/settlements', shifted, admin)).status).toBe(409);
    expect(
      (
        await app.post(
          `/payments/settlements/${first.body.settlementId}/finalise`,
          { tenantId },
          admin,
        )
      ).status,
    ).toBe(201);
  });

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
    // The week after the last one settled here — settlements never overlap.
    const from = await nextQuietWeek();
    const to = new Date(from.getTime() + 6 * 86_400_000);

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
