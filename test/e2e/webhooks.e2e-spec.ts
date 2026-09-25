import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Operator webhooks (Distribution). The platform POSTs to the URL an operator
 * saves and "send test" reports the answer back — so a URL inside the
 * platform's own network (localhost, cloud metadata, private ranges) was a way
 * to probe internal services. Such URLs are refused, the same URL cannot be
 * registered twice, and another operator's webhook is out of reach.
 */
describe('webhooks (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  const op = { as: 'operator' as const };
  const created: string[] = [];
  const run = Date.now().toString(36);

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
  });
  afterAll(async () => {
    for (const id of created) await app.del(`/webhooks/${id}`, op);
    await app.close();
  });

  const register = async (url: string, headers?: Record<string, string>) => {
    const r = await app.post('/webhooks', { name: 'E2E partner', url }, headers ? { headers } : op);
    if (r.status === 201 && !headers) created.push(r.body.id);
    return r;
  };

  it('refuses a URL that is not a public https endpoint', async () => {
    for (const url of [
      'http://partner.example.com/hook',
      'https://localhost/hook',
      'https://127.0.0.1:8080/admin',
      'https://169.254.169.254/latest/meta-data/',
      'https://10.0.0.5/hook',
      'https://[::1]/hook',
      'https://metadata.google.internal/',
      'https://user:secret@partner.example.com/hook',
    ]) {
      const r = await register(url);
      expect(r.status, url).toBe(400);
      expect(r.body.errors.issues[0].path).toBe('url');
    }
  });

  it('registers once per URL, and only the owner can see or revoke it', async () => {
    const url = `https://partner-${run}.example.com/ticketly`;
    const first = await register(url);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.secret).toMatch(/.{20,}/);

    const again = await register(url);
    expect(again.status).toBe(409);
    expect(again.body.detail).toMatch(/already registered/);

    const list = await app.get('/webhooks', op);
    const mine = list.body.items.find((w: { id: string }) => w.id === first.body.id);
    expect(mine).toMatchObject({ url, isActive: true });
    expect(mine.secret).toBeUndefined(); // shown once, never listed

    const id = first.body.id as string;
    expect((await app.get(`/webhooks/${id}/deliveries`, { headers: otherOperator })).status).toBe(
      404,
    );
    expect((await app.post(`/webhooks/${id}/test`, {}, { headers: otherOperator })).status).toBe(
      404,
    );
    expect((await app.del(`/webhooks/${id}`, { headers: otherOperator })).status).toBe(404);
    expect((await app.get(`/webhooks/${id}/deliveries`, op)).status).toBe(200);

    expect((await app.del(`/webhooks/${id}`, op)).status).toBe(200);
    expect((await app.del(`/webhooks/${id}`, op)).status).toBe(404); // already revoked
    // Revoked, the URL can be registered again (with a new secret).
    const renewed = await register(url);
    expect(renewed.status).toBe(201);
    expect(renewed.body.secret).not.toBe(first.body.secret);
  });

  it('a name that resolves inside the network is never called', async () => {
    // localtest.me is public DNS that answers 127.0.0.1.
    const r = await register(`https://${run}.localtest.me/hook`);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const test = await app.post(`/webhooks/${r.body.id}/test`, {}, op);
    expect(test.status).toBe(200);
    expect(test.body.ok).toBe(false);
    expect(test.body.responseStatus).toBeNull();
    expect(test.body.error).toMatch(/private address|Cannot resolve/);
  });
});
