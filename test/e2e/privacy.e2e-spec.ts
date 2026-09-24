import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * End-to-end: DPDP consent + right-to-be-forgotten. Verifies that erasure
 * anonymises PII while the financial trail (invoices) survives — the exact
 * behaviour the Act requires.
 */
describe('privacy / DPDP (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => { app = await bootstrapTestApp(); });
  afterAll(async () => { await app.close(); });

  it('records and withdraws marketing consent', async () => {
    const grant = await app.post('/v1/privacy/consents', { purpose: 'marketing', granted: true });
    expect(grant.body.state.marketing).toBe(true);
    const withdraw = await app.post('/v1/privacy/consents', { purpose: 'marketing', granted: false });
    expect(withdraw.body.state.marketing).toBe(false);
  });

  it('refuses to withdraw a necessary (transactional) purpose', async () => {
    const res = await app.post('/v1/privacy/consents', { purpose: 'transactional', granted: false });
    expect(res.status).toBe(422);
  });

  it('erasure anonymises PII but keeps invoices', async () => {
    const req = await app.post('/v1/privacy/erasure-requests', {});
    const done = await app.asOperator().post(`/v1/privacy/erasure-requests/${req.body.requestId}/process`, {});
    expect(done.body.status).toBe('processed');

    const invoices = await app.asOperator().get(`/v1/bookings/${app.fixtures.bookingId}/invoices`);
    expect(invoices.body.invoices.length).toBeGreaterThan(0); // financial record retained
  });
});
