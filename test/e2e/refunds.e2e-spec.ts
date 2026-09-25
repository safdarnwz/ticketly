import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * Refunds the operator handles by hand. A refund to another bank account was
 * impossible (the account details never reached the service) and, had it been
 * recorded, could never be marked as sent. Now: the queue shows what needs a
 * person, the account is shown in full only to someone who pays refunds, the
 * transfer is recorded with its UTR once, and nothing refunds more than was paid.
 */
describe('refunds (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let bookingId: string;
  let pnr: string;
  const op = { as: 'operator' as const };
  let n = 0;
  const key = () => `e2e-refund-${Date.now()}-${(n += 1)}`;
  const account = {
    accountHolder: 'Asha Verma',
    accountNumber: '5010 0123 4567 89',
    ifsc: 'hdfc0001234',
    bankName: 'HDFC Bank',
  };

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
    ({ bookingId, pnr } = await confirmedBooking(app, app.fixtures.seatNumbers[0], {
      fullName: 'Refund Person',
      age: 36,
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  const initiate = (body: object, idempotencyKey = key()) =>
    app.post('/refunds', { bookingId, ...body }, { ...op, idempotencyKey });
  const summary = () => app.get(`/bookings/${bookingId}/refunds`, op);

  it('refuses bad bank details and more than was paid', async () => {
    const s = await summary();
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.capturedMinor).toBeGreaterThan(0);
    expect(s.body.refundableMinor).toBe(s.body.capturedMinor);

    for (const [alt, field] of [
      [{ ...account, ifsc: 'HDFC123' }, 'ifsc'],
      [{ ...account, accountNumber: '12AB' }, 'accountNumber'],
      [{ ...account, accountHolder: ' ' }, 'accountHolder'],
    ] as [object, string][]) {
      const r = await initiate({
        amountMinor: 100,
        destination: 'alternate_account',
        altAccountDetails: alt,
      });
      expect(r.status, JSON.stringify(alt)).toBe(400);
      expect(r.body.errors.issues[0].path).toContain(field);
    }
    expect((await initiate({ amountMinor: 100, destination: 'alternate_account' })).status).toBe(
      400,
    );
    expect((await initiate({ amountMinor: 50 })).status).toBe(400); // under ₹1
    const over = await initiate({ amountMinor: s.body.capturedMinor + 100 });
    expect(over.status).toBe(422);
    expect(over.body.detail).toMatch(/exceeds what remains refundable/);
  });

  it('a refund to another account waits in the queue until the transfer is recorded', async () => {
    const k = key();
    const r = await initiate(
      { amountMinor: 10000, destination: 'alternate_account', altAccountDetails: account },
      k,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('processing');
    // A retried request is the same refund, not a second one.
    const again = await initiate(
      { amountMinor: 10000, destination: 'alternate_account', altAccountDetails: account },
      k,
    );
    expect(again.body.refundId).toBe(r.body.refundId);
    const id = r.body.refundId as string;

    const q = await app.get(`/refunds?queue=action&pnr=${pnr}`, op);
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    const row = q.body.items.find((x: { id: string }) => x.id === id);
    expect(row).toMatchObject({
      pnr,
      amountMinor: 10000,
      destination: 'alternate_account',
      accountHolder: 'Asha Verma',
      accountMasked: '••••6789',
      ifsc: 'HDFC0001234',
    });
    expect(JSON.stringify(q.body)).not.toContain('50100123456789');
    expect(q.body.needsAction).toBeGreaterThanOrEqual(1);

    const payout = await app.get(`/refunds/${id}/payout`, op);
    expect(payout.body).toMatchObject({ accountNumber: '50100123456789', ifsc: 'HDFC0001234' });

    const mark = (body: object, headers?: Record<string, string>) =>
      app.post(`/refunds/${id}/manual`, body, {
        ...(headers ? { headers } : op),
        idempotencyKey: key(),
      });
    expect((await mark({})).status).toBe(400);
    expect((await mark({ reference: 'x' })).status).toBe(400);
    expect((await mark({ reference: 'HDFCN52026092512345' }, otherOperator)).status).toBe(404);
    expect((await mark({ reference: 'hdfcn52026092512345' })).status).toBe(200);
    const twice = await mark({ reference: 'HDFCN52026092599999' });
    expect(twice.status).toBe(422);
    expect(twice.body.detail).toMatch(/already been paid/);

    const done = await app.get(`/refunds?queue=done&pnr=${pnr}`, op);
    expect(done.body.items.find((x: { id: string }) => x.id === id)).toMatchObject({
      status: 'manual',
      payoutReference: 'HDFCN52026092512345',
    });
    const after = await summary();
    expect(after.body.refundedMinor).toBe(10000);
    expect(after.body.refundableMinor).toBe(after.body.capturedMinor - 10000);
  });

  it("another operator cannot see or touch this operator's refunds", async () => {
    expect(
      (await app.get(`/bookings/${bookingId}/refunds`, { headers: otherOperator })).status,
    ).toBe(404);
    const theirs = await app.get(`/refunds?queue=all&pnr=${pnr}`, { headers: otherOperator });
    expect(theirs.status).toBe(200);
    expect(theirs.body.items).toHaveLength(0);
    const any = (await app.get(`/refunds?queue=all&pnr=${pnr}`, op)).body.items[0].id as string;
    expect((await app.get(`/refunds/${any}/payout`, { headers: otherOperator })).status).toBe(404);
    expect(
      (
        await app.post(
          '/refunds',
          { bookingId, amountMinor: 100 },
          { headers: otherOperator, idempotencyKey: key() },
        )
      ).status,
    ).toBe(404);
    expect((await app.get('/refunds?cursor=garbage', op)).status).toBe(400);
  });
});
