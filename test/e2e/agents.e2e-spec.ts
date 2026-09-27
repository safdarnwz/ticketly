import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

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
  let agentUserId: string;
  let soldPnr: string | undefined;
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
    agentUserId = ok.body.userId;
    expect((await create({ name: `Other ${run}` })).status).toBe(409); // same login email
    if (theirBranch)
      expect((await app.patch(`/agents/${agentId}`, { branchId: theirBranch.id }, op)).status).toBe(
        404,
      );
    expect((await app.get(`/agents/${agentId}`, { headers: other })).status).toBe(404);
  });

  it("an agent's login is not staff: not listed, not counted, never given an operator role", async () => {
    const staff = await app.get('/users?limit=200', op);
    expect(staff.status).toBe(200);
    const ids = (staff.body.items ?? staff.body) as { id: string }[];
    expect(ids.some((u) => u.id === agentUserId)).toBe(false);
    expect((await app.get(`/users/${agentUserId}`, op)).status).toBe(404);
    const admin = ((await app.get('/roles', op)).body.items as { id: string; code: string }[]).find(
      (r) => r.code === 'admin' || r.code === 'operator_admin',
    )!;
    expect((await app.put(`/users/${agentUserId}/roles/${admin.id}`, {}, op)).status).toBe(404);
    expect(
      (await app.post(`/users/${agentUserId}/roles`, { roles: [admin.code] }, op)).status,
    ).toBe(404);
    expect(
      (await app.put(`/users/${agentUserId}/password`, { password: 'Taken-over-123' }, op)).status,
    ).toBe(404);
    expect((await app.put(`/users/${agentUserId}/branch`, { branchId: null }, op)).status).toBe(
      404,
    );
    // A suspended agent cannot be switched back on through the staff screen.
    expect((await app.patch(`/users/${agentUserId}`, { status: 'active' }, op)).status).toBe(404);
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
    soldPnr = sold.body.pnr;
    // The agent's own view: the journey, the stops and the commission this sale earned.
    const mine = await app.get(`/agent-portal/bookings/${sold.body.bookingId}`, agent);
    expect(mine.status).toBe(200);
    expect(mine.body.journey).toMatchObject({
      routeName: expect.any(String),
      boardingStop: expect.any(String),
      commissionMinor: sold.body.commissionMinor,
    });
    const listed = (await app.get('/agent-portal/bookings', agent)).body.items as {
      id: string;
      commissionMinor: number;
    }[];
    expect(listed.find((b) => b.id === sold.body.bookingId)?.commissionMinor).toBe(
      sold.body.commissionMinor,
    );
    // Today's history (the operator's day) lists it the same way; a reversed window is refused.
    const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const todays = (await app.get(`/agent-portal/bookings?from=${day}&to=${day}`, agent)).body
      .items as { id: string; commissionMinor: number }[];
    expect(todays.find((b) => b.id === sold.body.bookingId)?.commissionMinor).toBe(
      sold.body.commissionMinor,
    );
    expect(
      (await app.get('/agent-portal/bookings?from=2026-09-10&to=2026-09-01', agent)).status,
    ).toBe(400);
    const me = await app.get('/agent-portal/me', agent);
    expect(me.body.operator).toMatchObject({ name: expect.any(String), email: expect.any(String) });
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

  it('a formal complaint: about its own sale only, decided once', async () => {
    const raise = (body: Record<string, unknown>, k = key()) =>
      app.post(`/agents/${agentId}/complaints`, body, k);
    const what = { category: 'overcharging', description: 'Charged the passenger ₹200 over fare' };
    expect((await raise({ ...what, description: 'short' })).status).toBe(400);
    expect((await raise({ ...what, category: 'rude' })).status).toBe(400);
    expect((await raise({ ...what, pnr: 'NOPE0000' })).status).toBe(404);
    const direct = await confirmedBooking(app, app.fixtures.seatNumbers[2], {
      fullName: 'Direct Buyer',
      age: 33,
    });
    expect((await raise({ ...what, pnr: direct.pnr })).status).toBe(422); // not sold by this agent
    expect(
      (await app.post('/agents/00000000-0000-4000-8000-000000000000/complaints', what, key()))
        .status,
    ).toBe(404);
    expect(
      (
        await app.post(`/agents/${agentId}/complaints`, what, {
          headers: other,
          idempotencyKey: `e2e-agent-other-${run}`,
        })
      ).status,
    ).toBe(404);

    const k = key();
    const body = { ...what, pnr: soldPnr?.toLowerCase() };
    const made = await raise(body, k);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect((await raise(body, k)).body.id).toBe(made.body.id); // retry

    const list = await app.get(`/agents/${agentId}/complaints`, op);
    expect(list.body.items[0]).toMatchObject({
      id: made.body.id,
      status: 'open',
      pnr: soldPnr ?? null,
    });
    expect((await app.get(`/agents/${agentId}/complaints`, { headers: other })).status).toBe(404);

    const decide = (outcome: string, resolution = 'Warned in writing; fare difference refunded') =>
      app.post(
        `/agents/${agentId}/complaints/${made.body.id}/decision`,
        { outcome, resolution },
        key(),
      );
    expect((await decide('upheld', 'ok')).status).toBe(400);
    expect((await decide('upheld')).status).toBe(200);
    expect((await decide('upheld')).status).toBe(200); // the same decision again is a retry
    expect((await decide('dismissed')).status).toBe(422);
    expect(
      (
        await app.post(
          `/agents/${agentId}/complaints/00000000-0000-4000-8000-000000000000/decision`,
          { outcome: 'dismissed', resolution: 'Not found' },
          key(),
        )
      ).status,
    ).toBe(404);
    const after = await app.get(`/agents/${agentId}/complaints`, op);
    expect(after.body.items[0]).toMatchObject({
      status: 'upheld',
      resolvedByName: expect.any(String),
    });
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
