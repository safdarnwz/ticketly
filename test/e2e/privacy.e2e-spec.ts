import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * End-to-end: DPDP consent + right to be forgotten, as the signed-in customer
 * exercises them, with the platform admin fulfilling erasure.
 */
describe('privacy / DPDP (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a customer records and withdraws marketing consent', async () => {
    const grant = await app.post('/privacy/consents', { purpose: 'marketing', granted: true });
    expect(grant.status).toBe(200);
    const withdraw = await app.post('/privacy/consents', { purpose: 'marketing', granted: false });
    expect(withdraw.status).toBe(200);
    const state = await app.get('/privacy/consents');
    expect(state.body.consents.marketing).toBe(false);
  });

  it('a necessary (transactional) purpose cannot be withdrawn', async () => {
    const res = await app.post('/privacy/consents', { purpose: 'transactional', granted: false });
    expect(res.status).toBe(422);
  });

  it('erasure is requested by the customer and fulfilled by the platform admin', async () => {
    const req = await app.post('/privacy/erasure-requests', {});
    expect(req.status).toBe(201);
    const done = await app.post(
      `/privacy/erasure-requests/${req.body.requestId}/process`,
      {},
      { as: 'platformAdmin' },
    );
    expect(done.body.status).toBe('processed');
  });

  it('privacy self-service needs a signed-in user', async () => {
    const res = await app.post(
      '/privacy/consents',
      { purpose: 'marketing', granted: true },
      { as: 'anonymous' },
    );
    expect(res.status).toBe(401);
  });
});
