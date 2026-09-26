import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/** The operator's financial audit trail: every ledger entry with its postings. */
describe('ledger journal (e2e)', () => {
  let app: TestApp;
  const as = { as: 'operator' as const };
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const journal = (qs: string, who: typeof as | { as: 'customer' } = as) =>
    app.get(`/payments/ledger/entries?${qs}`, who);

  beforeAll(async () => {
    app = await bootstrapTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('a paid booking shows up as a balanced capture entry, traceable by PNR', async () => {
    const { bookingId, pnr } = await confirmedBooking(app, app.fixtures.seatNumbers[0], {
      fullName: 'Ledger Trace',
      age: 40,
    });
    const r = await journal(`from=${today}&to=${today}&pnr=${pnr.toLowerCase()}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items).toHaveLength(1);
    const e = r.body.items[0];
    expect(e).toMatchObject({ type: 'booking.captured', sourceId: bookingId, pnr });
    const postings: { amountMinor: number }[] = e.postings;
    expect(postings.reduce((s, p) => s + p.amountMinor, 0)).toBe(0);

    const refunds = await journal(`from=${today}&to=${today}&pnr=${pnr}&type=refund.paid`);
    expect(refunds.body.items).toHaveLength(0);
  });

  it('pages newest first without repeating an entry', async () => {
    const first = await journal(`from=${today}&to=${today}&limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextBefore).toBe(first.body.items[0].id);
    const next = await journal(`from=${today}&to=${today}&limit=1&before=${first.body.nextBefore}`);
    for (const e of next.body.items) expect(e.id < first.body.items[0].id).toBe(true);
  });

  it('refuses a bad period, an unknown type and a customer', async () => {
    expect((await journal('from=2026-09-26&to=2026-01-01')).status).toBe(400);
    expect((await journal('from=2024-01-01&to=2026-01-01')).status).toBe(400);
    expect((await journal(`from=${today}&to=${today}&type=bogus`)).status).toBe(400);
    expect((await journal(`from=${today}&to=${today}&before=nope`)).status).toBe(400);
    expect((await journal(`from=${today}&to=${today}`, { as: 'customer' })).status).toBe(403);
    const none = await journal('from=1990-01-01&to=1990-01-31');
    expect(none.body).toEqual({ items: [], nextBefore: null });
  });
});
