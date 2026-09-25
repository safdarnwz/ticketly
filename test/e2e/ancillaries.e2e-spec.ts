import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
      { code, name: 'Extra luggage', kind: 'luggage', priceMinor: 10_000 },
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
});
