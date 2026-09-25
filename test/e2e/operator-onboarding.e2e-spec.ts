import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';
import { createContext, runWithContext } from '@kernel';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * An operator applies, the platform approves, and the applicant runs a working
 * operator: signs in with the password chosen when applying, holds every
 * operator permission (but not the platform's `*`), can invite staff into the
 * default roles, and has the default notification templates, bank and GST
 * details on file. Approval and POST /admin/tenants share one provisioning
 * path.
 */
describe('operator onboarding (e2e)', () => {
  let app: TestApp;
  let tenantId: string;
  let owner: Record<string, string>;
  const suffix = Date.now().toString().slice(-6);
  const letters = (n: number) =>
    Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(
      '',
    );
  const pan = `${letters(3)}C${letters(1)}${suffix.slice(-4)}${letters(1)}`;
  const gstin = `27${pan}1Z${letters(1)}`;
  const email = `applicant-${suffix}@ticketly.test`;
  const password = 'Applicant-pass-123';

  const db = <T>(sql: string, params: unknown[]) =>
    runWithContext(createContext({ actorType: 'system' }), () =>
      app.nest
        .get(UnitOfWork)
        .run({ name: 'e2e.read', bypassRls: true, readOnly: true }, async (s) => {
          const r = await s.client.query(sql, params);
          return r.rows as T[];
        }),
    );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const applied = await app.post(
      '/operators/apply',
      {
        firstName: 'Asha',
        lastName: 'Verma',
        email,
        mobile: `9${suffix}123`,
        password,
        companyName: `Verma Travels ${suffix}`,
        gstNumber: gstin,
        panNumber: pan,
        addressLine1: '12 MG Road',
        city: 'Pune',
        state: 'Maharashtra',
        pinCode: '411001',
        bankAccountHolder: 'Verma Travels',
        bankAccountNumber: `1234${suffix}00`,
        bankIfsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
      },
      { as: 'anonymous', idempotencyKey: `e2e-apply-${suffix}` },
    );
    expect(applied.status, JSON.stringify(applied.body)).toBeLessThan(300);

    const approved = await app.post(
      `/admin/operator-applications/${applied.body.applicationId}/approve`,
      {},
      { as: 'platformAdmin', idempotencyKey: `e2e-approve-${suffix}` },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    tenantId = approved.body.tenantId;

    const login = await app.post(
      '/auth/login',
      { identifier: email, password },
      { headers: { 'x-tenant-slug': approved.body.slug } },
    );
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    owner = {
      authorization: `Bearer ${login.body.accessToken}`,
      'x-tenant-slug': approved.body.slug,
    };
  });
  afterAll(async () => {
    await app.close();
  });

  it('the owner holds a tenant copy of operator_admin, not the platform wildcard', async () => {
    const rows = await db<{ code: string; tenant_id: string | null; wildcard: boolean }>(
      `SELECT r.code, r.tenant_id,
              EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission = '*') AS wildcard
         FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1`,
      [tenantId],
    );
    expect(rows).toEqual([{ code: 'operator_admin', tenant_id: tenantId, wildcard: false }]);
  });

  it('the owner can invite staff into a default role', async () => {
    const invite = await app.post(
      '/users',
      {
        fullName: 'Ravi Staff',
        email: `staff-${suffix}@ticketly.test`,
        password: 'Staff-pass-1234',
        roles: ['manager'],
      },
      { headers: owner, idempotencyKey: `e2e-invite-${suffix}` },
    );
    expect(invite.status, JSON.stringify(invite.body)).toBeLessThan(300);
  });

  it('bank, GST details and the default notification templates are on file', async () => {
    const [tenant] = await db<{ gstin: string; bank_ifsc: string; templates: number }>(
      `SELECT t.gstin, t.bank_ifsc,
              (SELECT count(*)::int FROM notification_templates n WHERE n.tenant_id = t.id) AS templates
         FROM tenants t WHERE t.id = $1`,
      [tenantId],
    );
    expect(tenant.gstin).toBe(gstin);
    expect(tenant.bank_ifsc).toBe('HDFC0001234');
    expect(tenant.templates).toBeGreaterThan(10);
  });
});
