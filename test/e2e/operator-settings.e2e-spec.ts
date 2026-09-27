import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

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

  it('free cancellation window: a full refund soon after paying, then the tiers', async () => {
    const before = (await app.get('/operator/refund-policy', op)).body;
    const set = (body: object) => app.patch('/operator/refund-policy', body, op);
    const noRefund = { tiers: [{ minHoursBeforeDeparture: 0, refundPct: 0 }], flatFeeMinor: 1000 };
    try {
      expect((await set({ ...noRefund, freeCancellationHours: 100 })).status).toBe(400);
      expect((await set({ ...noRefund, freeCancellationHours: 2 })).status).toBe(200);
      const { bookingId } = await confirmedBooking(app, app.fixtures.seatNumbers[0], {
        fullName: 'Free Window',
        age: 30,
      });
      const inWindow = await app.get(`/bookings/${bookingId}/refund-preview`);
      expect(inWindow.body).toMatchObject({ refundPct: 100, cancellable: true });
      expect(inWindow.body.refundMinor).toBeGreaterThan(0);
      // Without the window the same booking gets nothing back.
      expect((await set(noRefund)).status).toBe(200);
      const outside = await app.get(`/bookings/${bookingId}/refund-preview`);
      expect(outside.body).toMatchObject({ refundPct: 0, refundMinor: 0 });
    } finally {
      if (before.isCustom) await set(before.policy);
      else await app.post('/operator/refund-policy/reset', {}, op);
    }
  });

  it('waitlist rules: bounded, the operator’s own, back to the default on reset', async () => {
    const def = await app.get('/operator/waitlist-rules', op);
    expect(def.status).toBe(200);
    const put = (body: object, who: object = op) => app.put('/operator/waitlist-rules', body, who);
    const good = {
      maxPerTrip: 20,
      maxSeatsPerEntry: 4,
      closeMinutesBefore: 120,
      entryExpiryHours: 24,
    };
    try {
      for (const bad of [
        { ...good, maxPerTrip: 0 },
        { ...good, maxSeatsPerEntry: 11 },
        { ...good, closeMinutesBefore: -1 },
        { ...good, entryExpiryHours: 0 },
      ])
        expect((await put(bad)).status).toBe(400);
      expect((await put(good, { as: 'customer' })).status).toBe(403);
      expect((await put(good)).status).toBe(200);
      expect((await app.get('/operator/waitlist-rules', op)).body).toEqual({
        rules: good,
        isCustom: true,
      });
      const reset = await app.post('/operator/waitlist-rules/reset', {}, op);
      expect(reset.body.rules).toEqual({
        maxPerTrip: 100,
        maxSeatsPerEntry: 6,
        closeMinutesBefore: 60,
        entryExpiryHours: null,
      });
      expect((await app.get('/operator/waitlist-rules', op)).body.isCustom).toBe(false);
    } finally {
      if (def.body.isCustom) await put(def.body.rules);
      else await app.post('/operator/waitlist-rules/reset', {}, op);
    }
  });

  it('luggage policy: bounded, shown with every trip, withdrawn on reset', async () => {
    const before = (await app.get('/operator/luggage-policy', op)).body.policy;
    const put = (body: object, who: object = op) => app.put('/operator/luggage-policy', body, who);
    const good = { freeKg: 15, freePieces: 2, extraPerKgMinor: 2000, note: 'One cabin bag free' };
    try {
      for (const bad of [
        { ...good, freeKg: 101 },
        { ...good, freePieces: -1 },
        { ...good, extraPerKgMinor: 50 },
        { ...good, note: 'x'.repeat(301) },
      ])
        expect((await put(bad)).status).toBe(400);
      expect((await put(good, { as: 'customer' })).status).toBe(403);
      expect((await put(good)).status).toBe(200);
      const trip = await app.get(`/scheduling/trips/${app.fixtures.tripId}`, { as: 'anonymous' });
      expect(trip.status).toBe(200);
      expect(trip.body.luggage).toEqual(good);
      await app.post('/operator/luggage-policy/reset', {}, op);
      expect(
        (await app.get(`/scheduling/trips/${app.fixtures.tripId}`, { as: 'anonymous' })).body
          .luggage,
      ).toBeNull();
    } finally {
      if (before) await put(before);
      else await app.post('/operator/luggage-policy/reset', {}, op);
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
