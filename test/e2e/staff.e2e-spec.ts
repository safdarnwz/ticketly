import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * The operator's staff: directory, branch, roles and counter sales. A counter
 * sale used to record the staff member as the booking's customer — they then
 * appeared among customers and could act as the passenger. There was also no
 * staff list at all, and nothing stopped an admin disabling themselves.
 */
describe('staff (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let me: string;
  let hired: string;
  const op = { as: 'operator' as const };
  const run = Date.now().toString(36);
  const mobile = `98${String(Date.now()).slice(-8)}`;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const login = await app.post(
      '/auth/login',
      { identifier: 'admin@maharaja-yatra.example', password: 'pass@123' },
      { headers: { 'x-tenant-slug': 'maharaja-yatra', 'x-debug-surface': 'tenantAdmin' } },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    otherOperator = {
      authorization: `Bearer ${login.body.accessToken}`,
      'x-tenant-slug': 'maharaja-yatra',
    };
    me = (await app.get('/auth/me', op)).body.userId;
  });
  afterAll(async () => {
    if (hired) await app.patch(`/users/${hired}`, { status: 'disabled' }, op);
    await app.close();
  });

  it('hires with checked details and lists the directory', async () => {
    const invite = (body: object) =>
      app.post(
        '/users',
        {
          fullName: 'Counter Clerk',
          email: `clerk.${run}@demo-travels.example`,
          password: 'Clerk-pass-123',
          roles: ['agent'],
          ...body,
        },
        op,
      );
    expect((await invite({ phone: '12345' })).status).toBe(400);
    expect((await invite({ fullName: 'x' })).status).toBe(400);
    const ok = await invite({
      fullName: `=Clerk ${run}`,
      phone: `+91 ${mobile}`,
      email: `Clerk.${run}@Demo-Travels.example`,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    hired = ok.body.id;
    expect((await invite({})).status).toBe(409); // same email, any case
    const samePhone = await invite({ email: `other.${run}@demo-travels.example`, phone: mobile });
    expect(samePhone.status).toBe(409);
    expect(samePhone.body.detail).toBe('Someone already uses this mobile number');

    const list = await app.get(`/users?q=${encodeURIComponent(run)}`, op);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const row = list.body.items.find((u: { id: string }) => u.id === hired);
    expect(row).toMatchObject({
      phone: mobile,
      email: `clerk.${run}@demo-travels.example`,
      status: 'active',
    });
    expect(row.roles.map((r: { code: string }) => r.code)).toEqual(['agent']);
    const byEmail = await app.get(`/users?q=clerk.${run}@demo-travels.example`, op);
    expect(byEmail.body.items.map((u: { id: string }) => u.id)).toContain(hired);

    const csv = await app.nest.inject({
      method: 'GET',
      url: '/api/v1/users/export.csv',
      headers: {
        authorization: `Bearer ${app.fixtures.operatorToken}`,
        'x-tenant-slug': app.fixtures.tenantSlug,
      },
    });
    expect(csv.statusCode, csv.body.slice(0, 300)).toBe(200);
    expect(csv.body.split('\n')[0]).toBe(
      'name,email,mobile,status,branch,roles,last_login,access_until',
    );
    expect(csv.body).toContain(`'=Clerk ${run}`); // a formula is defused
    expect((await app.get(`/users/${hired}`, { headers: otherOperator })).status).toBe(404);
  });

  it('branches, roles and disabling have their guard rails', async () => {
    const branches = (await app.get('/branches', op)).body.items as {
      id: string;
      status: string;
    }[];
    const active = branches.find((b) => b.status === 'active');
    const theirBranch = (
      (await app.get('/branches', { headers: otherOperator })).body.items as { id: string }[]
    )[0];
    if (theirBranch)
      expect(
        (await app.put(`/users/${hired}/branch`, { branchId: theirBranch.id }, op)).status,
      ).toBe(404);
    if (active) {
      expect((await app.put(`/users/${hired}/branch`, { branchId: active.id }, op)).status).toBe(
        200,
      );
      expect((await app.get(`/users/${hired}`, op)).body.branchId).toBe(active.id);
    }
    expect((await app.put(`/users/${hired}/branch`, { branchId: null }, op)).status).toBe(200);

    const detail = (await app.get(`/users/${hired}`, op)).body;
    const agentRole = detail.roles[0].id as string;
    const only = await app.del(`/users/${hired}/roles/${agentRole}`, op);
    expect(only.status).toBe(422);
    expect(only.body.detail).toMatch(/at least one role/);
    expect(
      (await app.del(`/users/${hired}/roles/00000000-0000-4000-8000-000000000000`, op)).status,
    ).toBe(404);

    const self = await app.patch(`/users/${me}`, { status: 'disabled' }, op);
    expect(self.status).toBe(422);
    expect(self.body.detail).toMatch(/your own account/);

    // What the admin did shows in their activity.
    const mine = (await app.get(`/users/${me}`, op)).body.activity as {
      action: string;
      resourceId: string;
    }[];
    expect(mine.some((a) => a.action === 'user.invited' && a.resourceId === hired)).toBe(true);
  });

  it('a counter sale belongs to the seller, not the customer list', async () => {
    const day = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const f = app.fixtures;
    const q = await app.post('/pricing/quote', {
      tripId: f.tripId,
      fromStopId: f.fromStopId,
      toStopId: f.toStopId,
      seatType: 'seater',
      seatNumbers: [f.seatNumbers[2]],
    });
    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: q.body.quoteId,
        seatNumbers: [f.seatNumbers[2]],
        passengers: [{ seatNumber: f.seatNumbers[2], fullName: 'Walk In', age: 30 }],
        contactPhone: '9829077777',
        channel: 'backoffice',
      },
      { ...op, idempotencyKey: `e2e-counter-${run}` },
    );
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    const pay = await app.post(
      '/payments/charge',
      { bookingId: hold.body.bookingId, method: 'upi', vpa: 'success@ticketly' },
      { ...op, idempotencyKey: `e2e-counter-pay-${run}` },
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);

    const perf = await app.get(`/users/performance?from=${day}&to=${day}`, op);
    expect(perf.status).toBe(200);
    const mineRow = perf.body.items.find((r: { userId: string }) => r.userId === me);
    expect(mineRow.bookings).toBeGreaterThanOrEqual(1);
    expect(mineRow.revenueMinor).toBeGreaterThan(0);

    const cust = await app.get(`/customers?q=${hold.body.pnr}`, op);
    expect(cust.body.items).toHaveLength(1);
    expect(cust.body.items[0]).toMatchObject({ customerId: null, phone: '9829077777' }); // a guest, not staff
    expect((await app.get(`/users/performance?from=${day}&to=2020-01-01`, op)).status).toBe(400);
    // A customer cannot see staff.
    expect((await app.get('/users')).status).toBe(403);
  });
});
