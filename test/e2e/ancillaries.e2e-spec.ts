import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import { createContext, runAsTenant, runWithContext, type TenantId } from '@kernel';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { heldBooking } from './support/flows';

/**
 * Add-ons: the operator's catalogue, and add-ons attached to a booking before
 * payment — their price and GST go into the booking's own totals, so the
 * customer pays for them.
 */
describe('ancillaries (e2e)', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const totals = (bookingId: string) =>
    runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, () =>
        app.nest.get(UnitOfWork).run({ name: 'e2e.totals', readOnly: true }, async (s) => {
          const r = await s.client.query<{ total_minor: string; tax_minor: string }>(
            `SELECT total_minor, tax_minor FROM bookings WHERE id = $1`,
            [bookingId],
          );
          return { total: Number(r.rows[0].total_minor), tax: Number(r.rows[0].tax_minor) };
        }),
      ),
    );

  it('updating a catalogue item by code keeps its id', async () => {
    const code = `meal-${Date.now()}`;
    const item = { code, name: 'Veg meal', kind: 'meal', priceMinor: 15_000 };
    const first = await app.post('/me/ancillaries/catalogue', item, { as: 'operator' });
    expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);
    const again = await app.post(
      '/me/ancillaries/catalogue',
      { ...item, priceMinor: 16_000 },
      { as: 'operator' },
    );
    expect(again.body.id).toBe(first.body.id);
  });

  it('attaching add-ons to a held booking adds their price and GST to it', async () => {
    const code = `luggage-${Date.now()}`;
    const created = await app.post(
      '/me/ancillaries/catalogue',
      { code, name: 'Extra luggage', kind: 'luggage', priceMinor: 10_000, perPassenger: false },
      { as: 'operator' },
    );
    const { bookingId } = await heldBooking(app, app.fixtures.seatNumbers[0], {
      fullName: 'Addon Traveller',
    });
    const before = await totals(bookingId);

    const attach = await app.post(
      '/me/ancillaries/attach',
      { bookingId, items: [{ ancillaryId: created.body.id, quantity: 2 }] },
      { idempotencyKey: `e2e-attach-${bookingId}` },
    );
    expect(attach.status, JSON.stringify(attach.body)).toBeLessThan(300);
    const charged: number = attach.body.totalMinor;
    expect(charged).toBeGreaterThan(20_000); // 2 × ₹100 + GST

    const after = await totals(bookingId);
    expect(after.total - before.total).toBe(charged);
    expect(after.tax - before.tax).toBe(charged - 20_000);
  });

  it('the add-ons sent replace the previous ones: no double charge, and they can be removed', async () => {
    const meal = await app.post(
      '/me/ancillaries/catalogue',
      { code: `snack-${Date.now()}`, name: 'Snack box', kind: 'meal', priceMinor: 8_000 },
      { as: 'operator' },
    );
    const { bookingId } = await heldBooking(app, app.fixtures.seatNumbers[2], {
      fullName: 'Changeable Traveller',
    });
    const before = await totals(bookingId);
    const attach = (items: { ancillaryId: string; quantity: number }[], key: string) =>
      app.post(
        '/me/ancillaries/attach',
        { bookingId, items },
        { idempotencyKey: `${key}-${bookingId}` },
      );

    const once = await attach([{ ancillaryId: meal.body.id, quantity: 1 }], 'e2e-a1');
    expect(once.status, JSON.stringify(once.body)).toBeLessThan(300);
    const afterOnce = await totals(bookingId);
    // the same selection again (a retry with a new key, or a double click)
    const twice = await attach([{ ancillaryId: meal.body.id, quantity: 1 }], 'e2e-a2');
    expect(twice.status).toBeLessThan(300);
    expect(await totals(bookingId)).toEqual(afterOnce);
    // per-passenger add-on: no more than one per seat
    const tooMany = await attach([{ ancillaryId: meal.body.id, quantity: 2 }], 'e2e-a3');
    expect(tooMany.status).toBe(422);
    expect(await totals(bookingId)).toEqual(afterOnce);
    // removing every add-on puts the booking back exactly as it was
    const none = await attach([], 'e2e-a4');
    expect(none.status, JSON.stringify(none.body)).toBeLessThan(300);
    expect(await totals(bookingId)).toEqual(before);
  });

  it('a payment opened before an add-on is replaced, never charged at the old total', async () => {
    const code = `insurance-${Date.now()}`;
    const item = await app.post(
      '/me/ancillaries/catalogue',
      { code, name: 'Travel insurance', kind: 'insurance', priceMinor: 5_000 },
      { as: 'operator' },
    );
    const { bookingId } = await heldBooking(app, app.fixtures.seatNumbers[1], {
      fullName: 'Intent Traveller',
    });
    const open = () =>
      app.post('/payments/intent', { bookingId }, { idempotencyKey: `e2e-intent-${Date.now()}` });

    const first = await open();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    await app.post(
      '/me/ancillaries/attach',
      { bookingId, items: [{ ancillaryId: item.body.id, quantity: 1 }] },
      { idempotencyKey: `e2e-attach2-${bookingId}` },
    );
    const second = await open();
    expect(second.body.intentId).not.toBe(first.body.intentId);

    const rows = await runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, () =>
        app.nest.get(UnitOfWork).run({ name: 'e2e.intents', readOnly: true }, async (s) => {
          const r = await s.client.query<{ id: string; amount_minor: string; status: string }>(
            `SELECT id, amount_minor, status FROM payment_intents WHERE booking_id = $1`,
            [bookingId],
          );
          return r.rows;
        }),
      ),
    );
    const { total } = await totals(bookingId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(Number(byId.get(second.body.intentId)!.amount_minor)).toBe(total);
    expect(byId.get(first.body.intentId)!.status).toBe('failed'); // superseded
  });

  it('a payment for less than the total (add-on attached after the order) is refunded, not confirmed', async () => {
    const item = await app.post(
      '/me/ancillaries/catalogue',
      { code: `pillow-${Date.now()}`, name: 'Pillow', kind: 'other', priceMinor: 4_000 },
      { as: 'operator' },
    );
    const { bookingId } = await heldBooking(app, app.fixtures.seatNumbers[3], {
      fullName: 'Short Payer',
    });
    const intent = await app.post(
      '/payments/intent',
      { bookingId },
      { idempotencyKey: `e2e-short-intent-${bookingId}` },
    );
    expect(intent.status, JSON.stringify(intent.body)).toBe(201);
    const orderTotal = (await totals(bookingId)).total;
    await app.post(
      '/me/ancillaries/attach',
      { bookingId, items: [{ ancillaryId: item.body.id, quantity: 1 }] },
      { idempotencyKey: `e2e-short-attach-${bookingId}` },
    );
    expect((await totals(bookingId)).total).toBeGreaterThan(orderTotal);

    // The gateway captures the OLD order amount.
    const paymentId = `pay_short_${Date.now()}`;
    const raw = JSON.stringify({
      type: 'payment.captured',
      order_id: `mock_order_${intent.body.intentId}`,
      payment_id: paymentId,
      amount: orderTotal,
      status: 'captured',
    });
    const signature = createHmac('sha256', app.nest.get(AppConfig).security.jwtSecret)
      .update(raw)
      .digest('hex');
    const send = () =>
      app.post('/payments/webhook/test', raw, {
        headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
      });
    expect((await send()).status).toBeLessThan(300);
    expect((await send()).status).toBeLessThan(300); // the PSP retries

    const state = await runWithContext(createContext({ actorType: 'system' }), () =>
      runAsTenant(app.fixtures.tenantId as TenantId, () =>
        app.nest.get(UnitOfWork).run({ name: 'e2e.short', readOnly: true }, async (s) => {
          const b = await s.client.query<{ status: string }>(
            `SELECT status FROM bookings WHERE id = $1`,
            [bookingId],
          );
          const d = await s.client.query<{ status: string; amount_minor: string }>(
            `SELECT status, amount_minor FROM duplicate_payments WHERE gateway_payment_id = $1`,
            [paymentId],
          );
          return { booking: b.rows[0].status, refunds: d.rows };
        }),
      ),
    );
    expect(state.booking).toBe('held'); // never confirmed on a short payment
    expect(state.refunds).toHaveLength(1); // refunded once, even with the retry
    expect(Number(state.refunds[0].amount_minor)).toBe(orderTotal);
    expect(state.refunds[0].status).toBe('refunded');
  });
});
