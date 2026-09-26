import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Operator branches / counters: a name once per operator (whatever its case),
 * a real phone number, opening hours that make sense, and a manager who is one
 * of the operator's own staff — a foreign key alone accepted anybody's user.
 */
describe('branches (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let otherStaffId: string;
  const op = { as: 'operator' as const };
  const name = `E2E Counter ${Date.now().toString(36)}`;

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
    const me = await app.get('/auth/me', { headers: otherOperator });
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    otherStaffId = me.body.userId;
  });
  afterAll(async () => {
    await app.close();
  });

  const create = (body: object) => app.post('/branches', body, op);
  type BranchRow = { id: string; name: string; phone: string | null; status: string };
  const find = async (id: string): Promise<BranchRow | undefined> =>
    ((await app.get('/branches', op)).body.items as BranchRow[]).find((b) => b.id === id);

  it('refuses bad details', async () => {
    for (const [body, field] of [
      [{ name: ' ' }, 'name'],
      [{ name, phone: 'call me' }, 'phone'],
      [{ name, phone: '12345' }, 'phone'],
      [{ name, workingHours: { mon: { open: '9am', close: '18:00' } } }, 'workingHours'],
    ] as [object, string][]) {
      const r = await create(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.errors.issues[0].path).toContain(field);
    }
    const same = await create({ name, workingHours: { tue: { open: '10:00', close: '10:00' } } });
    expect(same.status).toBe(422);
  });

  it('one name per operator, and only its own staff can manage it', async () => {
    const r = await create({
      name,
      phone: '011 2345 6789',
      address: 'ISBT Kashmere Gate',
      workingHours: { mon: { open: '06:00', close: '22:00' }, sun: null },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.id as string;
    expect(await find(id)).toMatchObject({ name, phone: '011 2345 6789', status: 'active' });

    const dup = await create({ name: `  ${name.toUpperCase()} ` });
    expect(dup.status).toBe(409);
    expect(dup.body.detail).toBe('A branch with this name already exists');

    // Another operator's staff member cannot be made this branch's manager.
    expect((await app.patch(`/branches/${id}`, { managerUserId: otherStaffId }, op)).status).toBe(
      404,
    );
    // Renaming onto another branch's name is the same clash; keeping its own name is fine.
    expect((await app.patch(`/branches/${id}`, { name, phone: '9876543210' }, op)).status).toBe(
      200,
    );
    expect((await find(id))?.phone).toBe('9876543210');
    // Another operator can neither see nor change it.
    const theirs = await app.get('/branches', { headers: otherOperator });
    expect(theirs.body.items.some((b: { id: string }) => b.id === id)).toBe(false);
    expect(
      (await app.post(`/branches/${id}/deactivate`, {}, { headers: otherOperator })).status,
    ).toBe(404);

    expect((await app.post(`/branches/${id}/deactivate`, {}, op)).status).toBe(201);
    expect((await find(id))?.status).toBe('inactive');
    expect((await app.post(`/branches/${id}/activate`, {}, op)).status).toBe(201);
    expect((await find(id))?.status).toBe('active');
  });

  it('a short code, once per operator whatever its case', async () => {
    const code = `E${Date.now().toString(36).slice(-5)}`.toUpperCase();
    expect((await create({ name: `${name} code`, code: 'x' })).status).toBe(400);
    expect((await create({ name: `${name} code`, code: 'has space' })).status).toBe(400);
    const a = await create({ name: `${name} code A`, code: code.toLowerCase() });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(
      ((await app.get('/branches', op)).body.items as { id: string; code: string }[]).find(
        (b) => b.id === a.body.id,
      )?.code,
    ).toBe(code);
    const b = await create({ name: `${name} code B`, code });
    expect(b.status).toBe(409);
    await app.post(`/branches/${a.body.id}/deactivate`, {}, op);
  });
});
