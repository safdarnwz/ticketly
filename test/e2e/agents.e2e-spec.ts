import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * The operator's travel agents: onboarding, terms, money in and out, and the
 * statement. An agent could be put under another operator's branch (the id was
 * only checked by the foreign key), and a made-up branch id came back as a
 * confusing "record still in use".
 */
describe('agents (e2e)', () => {
  let app: TestApp;
  let other: Record<string, string>;
  let agentId: string;
  const op = { as: 'operator' as const };
  const run = Date.now().toString(36);
  const phone = `97${String(Date.now()).slice(-8)}`;
  let n = 0;
  const key = () => ({ ...op, idempotencyKey: `e2e-agent-${run}-${++n}` });

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const login = await app.post(
      '/auth/login',
      { identifier: 'admin@maharaja-yatra.example', password: 'pass@123' },
      { headers: { 'x-tenant-slug': 'maharaja-yatra', 'x-debug-surface': 'tenantAdmin' } },
    );
    other = {
      authorization: `Bearer ${login.body.accessToken}`,
      'x-tenant-slug': 'maharaja-yatra',
    };
  });
  afterAll(async () => {
    if (agentId)
      await app.post(
        `/agents/${agentId}/status`,
        { status: 'suspended', reason: 'End of e2e run' },
        op,
      );
    await app.close();
  });

  const base = {
    name: `E2E Travels ${run}`,
    contactPhone: phone,
    billingMode: 'postpaid',
    commissionPct: 5,
    creditLimitMinor: 500_000,
    loginEmail: `agent.${run}@demo-travels.example`,
    password: 'Agent-pass-123',
  };

  it('onboards with checked terms and a branch of this operator only', async () => {
    const create = (body: object) => app.post('/agents', { ...base, ...body }, key());
    expect((await create({ billingMode: 'prepaid' })).status).toBe(400); // prepaid + credit limit
    expect((await create({ commissionPct: 80 })).status).toBe(400);
    const made = await create({ branchId: '00000000-0000-4000-8000-000000000000' });
    expect(made.status).toBe(404);
    const theirBranch = (
      (await app.get('/branches', { headers: other })).body.items as { id: string }[]
    )[0];
    if (theirBranch) expect((await create({ branchId: theirBranch.id })).status).toBe(404);

    const ok = await create({});
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    agentId = ok.body.agentId;
    expect((await create({ name: `Other ${run}` })).status).toBe(409); // same login email
    if (theirBranch)
      expect((await app.patch(`/agents/${agentId}`, { branchId: theirBranch.id }, op)).status).toBe(
        404,
      );
    expect((await app.get(`/agents/${agentId}`, { headers: other })).status).toBe(404);
  });

  it('money in, corrections within the limit, slabs and the statement', async () => {
    const receipt = { amountMinor: 20_000, reference: `UTR-${run}` };
    const r1 = await app.post(`/agents/${agentId}/receipts`, receipt, key());
    expect(r1.body).toMatchObject({ applied: true, balanceMinor: 20_000 });
    const r2 = await app.post(`/agents/${agentId}/receipts`, receipt, key());
    expect(r2.body).toMatchObject({ applied: false, balanceMinor: 20_000 }); // same reference

    const breach = await app.post(
      `/agents/${agentId}/adjustments`,
      { amountMinor: -600_000, reason: 'Would pass the credit limit' },
      key(),
    );
    expect(breach.status).toBe(422);
    expect(
      (
        await app.post(
          `/agents/${agentId}/adjustments`,
          { amountMinor: -5_000, reason: 'short' },
          key(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.post(
          `/agents/${agentId}/adjustments`,
          { amountMinor: -5_000, reason: 'Bank charges on the transfer' },
          key(),
        )
      ).body.balanceMinor,
    ).toBe(15_000);

    const slabs = (s: object[]) => app.put(`/agents/${agentId}/commission-slabs`, { slabs: s }, op);
    expect((await slabs([{ minMonthlySalesMinor: 100, commissionPct: 5 }])).status).toBe(422);
    expect(
      (
        await slabs([
          { minMonthlySalesMinor: 0, commissionPct: 6 },
          { minMonthlySalesMinor: 100_000, commissionPct: 4 },
        ])
      ).status,
    ).toBe(422);
    expect(
      (
        await slabs([
          { minMonthlySalesMinor: 0, commissionPct: 4 },
          { minMonthlySalesMinor: 100_000, commissionPct: 6 },
        ])
      ).status,
    ).toBe(200);

    const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const st = await app.get(`/agents/${agentId}/statement?from=${day}&to=${day}`, op);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({
      receivedMinor: 20_000,
      adjustmentsMinor: -5_000,
      closingBalanceMinor: 15_000,
    });
  });

  it('an agent sale can be cancelled and refunded to the agent (offline refund ledger)', async () => {
    const login = await app.post(
      '/auth/login',
      { identifier: base.loginEmail, password: base.password },
      { headers: { 'x-tenant-slug': app.fixtures.tenantSlug, 'x-debug-surface': 'tenantAdmin' } },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const agent = {
      headers: {
        authorization: `Bearer ${login.body.accessToken}`,
        'x-tenant-slug': app.fixtures.tenantSlug,
      },
    };
    const f = app.fixtures;
    const seat = f.seatNumbers[3];
    const quote = await app.post('/pricing/quote', {
      tripId: f.tripId,
      fromStopId: f.fromStopId,
      toStopId: f.toStopId,
      seatType: 'seater',
      seatNumbers: [seat],
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    const sold = await app.post(
      '/agent-portal/bookings',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: [seat],
        passengers: [{ seatNumber: seat, fullName: 'Agent Walk In', age: 40 }],
        contactPhone: '9770000123',
      },
      { ...agent, idempotencyKey: `e2e-agent-sale-${run}` },
    );
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    const cancel = await app.post(
      `/agent-portal/bookings/${sold.body.bookingId}/cancel`,
      { reason: 'Passenger changed plans' },
      { ...agent, idempotencyKey: `e2e-agent-cancel-${run}` },
    );
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    if (cancel.body.refundMinor > 0) {
      const refund = await app.post(
        '/refunds',
        { bookingId: sold.body.bookingId, amountMinor: cancel.body.refundMinor },
        key(),
      );
      // Was a 500: the offline split compared ledger text ids with a uuid.
      expect(refund.status, JSON.stringify(refund.body)).toBe(200);
      expect(refund.body.status).toBe('settled');
    }
  });

  it('suspends with a reason and cannot cut credit below what is owed', async () => {
    expect(
      (await app.post(`/agents/${agentId}/status`, { status: 'suspended', reason: 'late' }, op))
        .status,
    ).toBe(400);
    expect(
      (
        await app.post(
          `/agents/${agentId}/status`,
          { status: 'suspended', reason: 'Payments are overdue' },
          op,
        )
      ).status,
    ).toBe(200);
    expect(
      (await app.get('/agents?status=suspended', op)).body.items.map((a: { id: string }) => a.id),
    ).toContain(agentId);
    expect((await app.post(`/agents/${agentId}/status`, { status: 'active' }, op)).status).toBe(
      200,
    );
    // Owes nothing now, so the limit can go to zero; a prepaid switch drops the limit.
    expect((await app.patch(`/agents/${agentId}`, { billingMode: 'prepaid' }, op)).status).toBe(
      200,
    );
    expect((await app.get(`/agents/${agentId}`, op)).body).toMatchObject({
      billingMode: 'prepaid',
      creditLimitMinor: 0,
    });
  });

  it('API keys carry no more than the issuer holds, and stop working once revoked', async () => {
    const issue = (body: object) =>
      app.post('/api-keys', { name: `E2E key ${run}`, scopes: ['agent:read'], ...body }, op);
    expect((await issue({ scopes: ['*'] })).status).toBe(403);
    expect((await issue({ scopes: ['platform:admin'] })).status).toBe(403);
    expect((await issue({ scopes: ['agents:read'] })).status).toBe(403); // typo
    expect((await issue({ ipAllowlist: ['not-an-ip'] })).status).toBe(400);
    expect((await issue({ expiresAt: '2020-01-01T00:00:00Z' })).status).toBe(400);
    const made = await issue({});
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const withKey = {
      headers: { 'x-api-key': made.body.apiKey, 'x-tenant-slug': app.fixtures.tenantSlug },
    };
    expect((await app.get('/agents', withKey)).status).toBe(200);
    expect((await app.get('/users', withKey)).status).toBe(403);
    expect((await app.del(`/api-keys/${made.body.id}`, { headers: other })).status).toBe(404);
    expect((await app.del(`/api-keys/${made.body.id}`, op)).status).toBe(204);
    expect((await app.get('/agents', withKey)).status).toBe(401);
  });
});
