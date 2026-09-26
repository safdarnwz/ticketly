import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';

/**
 * Operator settings: the payout account change request, the cancellation
 * policy tiers, and the message templates — each refusing what would silently
 * go wrong later (an account number of 4 digits, a policy that refunds more
 * the later you cancel, a placeholder that renders as a blank).
 */
describe('operator settings (e2e)', () => {
  let app: TestApp;
  const op = { as: 'operator' as const };

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('payout account: validated, never the same one twice, and withdrawable', async () => {
    const set = (body: object) => app.patch('/operator/bank-details', body, op);
    const good = {
      accountHolder: 'Demo Travels Pvt Ltd',
      accountNumber: '5010 0998 8776 65',
      ifsc: 'hdfc0000123',
    };
    for (const [body, field] of [
      [{ ...good, accountNumber: '1234' }, 'accountNumber'],
      [{ ...good, ifsc: 'HDFC123' }, 'ifsc'],
      [{ ...good, accountHolder: ' ' }, 'accountHolder'],
    ] as [object, string][]) {
      const r = await set(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.errors.issues[0].path).toBe(field);
    }
    await app.del('/operator/bank-details/pending', op); // clean slate
    expect((await set(good)).status).toBe(200);
    const again = await set(good);
    expect(again.status).toBe(409);
    expect(again.body.detail).toMatch(/already waiting/);
    const view = await app.get('/operator/bank-details', op);
    expect(view.body.pendingRequest).toMatchObject({
      accountNumberMasked: '••••7665',
      ifsc: 'HDFC0000123',
    });
    expect((await app.del('/operator/bank-details/pending', op)).status).toBe(200);
    expect((await app.del('/operator/bank-details/pending', op)).status).toBe(404);
    expect((await app.get('/operator/bank-details', op)).body.pendingRequest).toBeNull();
  });

  it('cancellation policy: tiers once each, and earlier never refunds less', async () => {
    const before = (await app.get('/operator/refund-policy', op)).body;
    const set = (body: object) => app.patch('/operator/refund-policy', body, op);
    try {
      const dup = await set({
        tiers: [
          { minHoursBeforeDeparture: 24, refundPct: 80 },
          { minHoursBeforeDeparture: 24, refundPct: 50 },
        ],
      });
      expect(dup.status).toBe(400);
      expect(dup.body.errors.issues[0].message).toMatch(/Two tiers/);
      const inverted = await set({
        tiers: [
          { minHoursBeforeDeparture: 48, refundPct: 50 },
          { minHoursBeforeDeparture: 12, refundPct: 90 },
        ],
      });
      expect(inverted.status).toBe(400);
      expect(inverted.body.errors.issues[0].message).toMatch(/never refund less/);
      expect((await set({ tiers: [] })).status).toBe(400);
      expect(
        (
          await set({
            tiers: [{ minHoursBeforeDeparture: 24, refundPct: 80 }],
            flatFeeMinor: 5_000_000,
          })
        ).status,
      ).toBe(400);
      const ok = await set({
        tiers: [
          { minHoursBeforeDeparture: 48, refundPct: 90 },
          { minHoursBeforeDeparture: 12, refundPct: 50 },
          { minHoursBeforeDeparture: 0, refundPct: 0 },
        ],
        flatFeeMinor: 2000,
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    } finally {
      // Put back what was there so other tests' refunds are unchanged.
      if (before.isCustom) await set(before.policy);
      else await app.post('/operator/refund-policy/reset', {}, op);
    }
  });

  it('connection rules: a sane layover window, back to the default on reset', async () => {
    const before = (await app.get('/operator/connection-rules', op)).body;
    expect(before.rules).toMatchObject({ enabled: expect.any(Boolean) });
    const put = (body: object) => app.put('/operator/connection-rules', body, op);
    try {
      expect((await put({ enabled: true, minLayoverMin: 60, maxLayoverMin: 60 })).status).toBe(400);
      expect((await put({ enabled: true, minLayoverMin: 5, maxLayoverMin: 300 })).status).toBe(400);
      expect((await put({ enabled: true, minLayoverMin: 60 })).status).toBe(400);
      expect(
        (
          await app.put('/operator/connection-rules', {
            enabled: false,
            minLayoverMin: 60,
            maxLayoverMin: 300,
          })
        ).status,
      ).toBe(403);
      expect((await put({ enabled: false, minLayoverMin: 45, maxLayoverMin: 300 })).status).toBe(
        200,
      );
      const now = (await app.get('/operator/connection-rules', op)).body;
      expect(now).toEqual({
        rules: { enabled: false, minLayoverMin: 45, maxLayoverMin: 300 },
        isCustom: true,
      });
    } finally {
      if (before.isCustom) await put(before.rules);
      else {
        const reset = await app.post('/operator/connection-rules/reset', {}, op);
        expect(reset.body.rules).toEqual({
          enabled: true,
          minLayoverMin: 120,
          maxLayoverMin: 1440,
        });
      }
    }
  });

  it('templates: known events and placeholders only, with the catalogue served', async () => {
    const list = await app.get('/notifications/templates', op);
    expect(list.status).toBe(200);
    expect(list.body.catalogue['trip.reminder.4h'].placeholders).toContain('driver.phone');
    const save = (body: object) => app.post('/notifications/templates', body, op);
    const typo = await save({
      eventType: 'booking.confirmed',
      channel: 'sms',
      body: 'PNR {{pnrr}}',
    });
    expect(typo.status).toBe(400);
    expect(typo.body.errors.issues[0]).toMatchObject({ path: 'body' });
    expect((await save({ eventType: 'no.such.event', channel: 'sms', body: 'hi' })).status).toBe(
      400,
    );
    expect(
      (await save({ eventType: 'booking.confirmed', channel: 'email', body: 'PNR {{pnr}}' }))
        .status,
    ).toBe(400);
    const original = (
      list.body.items as { eventType: string; channel: string; body: string }[]
    ).find((t) => t.eventType === 'booking.confirmed' && t.channel === 'sms');
    const ok = await save({
      eventType: 'booking.confirmed',
      channel: 'sms',
      body: 'Booked! PNR {{ pnr }}, seats {{seats}}.',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    if (original)
      await save({ eventType: 'booking.confirmed', channel: 'sms', body: original.body });
  });

  it('company profile: contacts and address, verified legal details fixed, logo kept', async () => {
    const before = (await app.get('/operator/profile', op)).body;
    expect(before).toHaveProperty('contactEmail');
    const logoBefore = (await app.get('/operator/logo', op)).body;
    const patch = (body: object) => app.patch('/operator/profile', body, op);
    expect((await patch({ settings: {} })).status).toBe(400); // could wipe logo and invoice prefix
    expect((await patch({ legalName: 'Someone Else Pvt Ltd' })).status).toBe(400);
    expect((await patch({ timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await patch({ contactPhone: '12345' })).status).toBe(400);
    expect(
      (await patch({ address: { line1: 'x', city: 'J', state: 'R', pincode: '012345' } })).status,
    ).toBe(400);
    expect((await patch({ currency: 'USD' })).status).toBe(422); // demo operator has bookings

    const ok = await patch({
      contactPhone: '+91 98290 12345',
      secondaryContact: {
        name: 'Ops Desk',
        phone: '9829012346',
        email: 'OPS@demo-travels.example',
      },
      address: { line1: '12 Station Road', city: 'Jaipur', state: 'Rajasthan', pincode: '302001' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = (await app.get('/operator/profile', op)).body;
    expect(after).toMatchObject({
      contactPhone: '9829012346'.replace(/6$/, '5'),
      secondaryContact: {
        name: 'Ops Desk',
        phone: '9829012346',
        email: 'ops@demo-travels.example',
      },
      address: { city: 'Jaipur', pincode: '302001' },
      registeredAddress: '12 Station Road, Jaipur, Rajasthan 302001',
    });
    expect((await patch({ secondaryContact: null })).status).toBe(200);
    expect((await app.get('/operator/profile', op)).body.secondaryContact).toBeNull();
    expect((await app.get('/operator/logo', op)).body).toEqual(logoBefore);
  });
});
