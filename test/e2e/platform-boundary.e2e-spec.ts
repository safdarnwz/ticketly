import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';
import { createContext, runWithContext } from '@kernel';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * An operator's owner holds the `*` wildcard inside its own tenant. That must
 * never open Ticketly's own platform routes (operator applications with other
 * companies' KYC, bank and PAN data; approvals).
 */
describe('platform boundary (e2e)', () => {
  let app: TestApp;
  let owner: Record<string, string>;
  let tenantId: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const suffix = Date.now().toString(36);
    const slug = `e2e-op-${suffix}`;
    const email = `owner-${suffix}@ticketly.test`;
    const password = 'Owner-pass-123';
    const provisioned = await app.post(
      '/admin/tenants',
      {
        slug,
        legalName: 'E2E Travels Pvt Ltd',
        displayName: 'E2E Travels',
        contactEmail: email,
        owner: { fullName: 'E2E Owner', email, password },
      },
      { as: 'platformAdmin', idempotencyKey: `e2e-provision-${suffix}` },
    );
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBeLessThan(300);
    tenantId = provisioned.body.tenantId;

    const login = await app.post(
      '/auth/login',
      { identifier: email, password },
      { headers: { 'x-tenant-slug': slug } },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    owner = { authorization: `Bearer ${login.body.accessToken}`, 'x-tenant-slug': slug };
  });
  afterAll(async () => {
    await app.close();
  });

  it("the owner can use its own operator's routes", async () => {
    const roles = await app.get('/roles', { headers: owner });
    expect(roles.status, JSON.stringify(roles.body)).toBe(200);
  });

  it('the owner cannot reach platform operator-application routes', async () => {
    const list = await app.get('/admin/operator-applications', { headers: owner });
    expect(list.status).toBe(403);
    const approve = await app.post(
      '/admin/operator-applications/00000000-0000-7000-8000-000000000000/approve',
      {},
      { headers: owner },
    );
    expect(approve.status).toBe(403);
  });

  it('an operator created by the platform admin gets the default notification templates', async () => {
    const [row] = await runWithContext(createContext({ actorType: 'system' }), () =>
      app.nest
        .get(UnitOfWork)
        .run({ name: 'e2e.templates', bypassRls: true, readOnly: true }, (s) =>
          s.client
            .query<{ n: number }>(
              `SELECT count(*)::int AS n FROM notification_templates WHERE tenant_id = $1`,
              [tenantId],
            )
            .then((r) => r.rows),
        ),
    );
    expect(row.n).toBeGreaterThan(10);
  });

  it('the platform admin still can', async () => {
    const list = await app.get('/admin/operator-applications', { as: 'platformAdmin' });
    expect(list.status).toBe(200);
  });

  it("one operator's platform settings: detail, feature flags, domain and rate limit", async () => {
    const sa = { as: 'platformAdmin' as const };
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const detail = await app.get(`/admin/tenants/${tenantId}`, sa);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body).toMatchObject({
      id: tenantId,
      displayName: 'E2E Travels',
      primaryDomain: null,
      apiRateLimit: null,
      hasFavicon: false,
      featureOverrides: {},
    });
    expect((await app.get(`/admin/tenants/${unknownId}`, sa)).status).toBe(404);
    expect((await app.get(`/admin/tenants/${tenantId}`, { headers: owner })).status).toBe(403);

    const flag = (id: string, enabled: boolean | null) =>
      app.put(`/admin/tenants/${id}/features/gps_tracking`, { enabled }, sa);
    expect((await flag(tenantId, true)).status).toBe(200);
    expect((await app.get(`/admin/tenants/${tenantId}`, sa)).body.featureOverrides).toEqual({
      gps_tracking: true,
    });
    expect((await flag(tenantId, null)).status).toBe(200);
    expect((await app.get(`/admin/tenants/${tenantId}`, sa)).body.featureOverrides).toEqual({});
    expect((await flag(unknownId, true)).status).toBe(404); // used to answer 200
    expect(
      (await app.put(`/admin/tenants/${tenantId}/features/bad key!`, { enabled: true }, sa)).status,
    ).toBe(400);

    expect((await app.put(`/admin/tenants/${tenantId}/rate-limit`, { limit: 5 }, sa)).status).toBe(
      400,
    );
    expect(
      (await app.put(`/admin/tenants/${tenantId}/rate-limit`, { limit: 600 }, sa)).status,
    ).toBe(200);
    expect(
      (await app.put(`/admin/tenants/${tenantId}/domain`, { domain: 'not a host' }, sa)).status,
    ).toBe(400);
    expect((await app.get(`/admin/tenants/${tenantId}`, sa)).body.apiRateLimit).toBe(600);
  });

  it('platform numbers: active buses and this month’s revenue (Indian days)', async () => {
    const r = await app.get('/admin/tenants/analytics', { as: 'platformAdmin' });
    expect(r.status).toBe(200);
    expect(r.body.activeBuses).toBeGreaterThan(0);
    expect(r.body.monthRevenueMinor).toBeGreaterThanOrEqual(0);
    expect(r.body.monthRevenueMinor).toBeLessThanOrEqual(r.body.totalRevenueMinor);
    expect((await app.get('/admin/tenants/analytics', { headers: owner })).status).toBe(403);
  });

  it('integrations describe their own form fields; secrets never come back', async () => {
    const r = await app.get('/admin/integrations', { as: 'platformAdmin' });
    expect(r.status).toBe(200);
    const smtp = (
      r.body.items as { provider: string; fields: { config: { key: string }[] } }[]
    ).find((i) => i.provider === 'smtp')!;
    expect(smtp.fields.config.map((f) => f.key)).toEqual(
      expect.arrayContaining(['host', 'port', 'secure', 'user', 'fromAddress']),
    );
    expect(JSON.stringify(r.body)).not.toMatch(/"password":"[^n•]/);
    expect((await app.get('/admin/integrations', { headers: owner })).status).toBe(403);
  });
});
