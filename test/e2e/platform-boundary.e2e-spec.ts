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
});
