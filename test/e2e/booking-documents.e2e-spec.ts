import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UnitOfWork } from '@database';
import { createContext, newId, runWithContext, type BookingId, type TenantId } from '@kernel';

import { documentEventId } from '../../apps/api/src/modules/notification';
import { InvoiceService } from '../../apps/api/src/modules/invoicing/application/services/invoice.service';
import { TicketService } from '../../apps/api/src/modules/tickets/application/services/ticket.service';
import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { heldBooking } from './support/flows';

/**
 * After payment the customer gets two emails — the e-ticket and the GST
 * invoice — each exactly once however often the event is redelivered, and the
 * platform admin sees every operator's bookings (and whether those emails
 * went out) without seeing customers' contact details.
 */
describe('booking documents and platform monitoring (e2e)', () => {
  let app: TestApp;
  let bookingId: BookingId;
  let pnr: string;
  const email = `docs.${Date.now()}@example.in`;
  const eventId = newId();

  // As the worker runs it: a system actor in the booking's operator.
  const inTenant = <T>(fn: () => Promise<T>) =>
    runWithContext(
      createContext({ actorType: 'system', tenantId: app.fixtures.tenantId as TenantId }),
      fn,
    );

  // This test's own sends (a running worker may also have sent the real event's).
  const documents = (id: string) =>
    runWithContext(createContext({ actorType: 'system' }), () =>
      app.nest.get(UnitOfWork).run(
        { name: 'e2e.documents', bypassRls: true, readOnly: true },
        async (s) =>
          (
            await s.client.query<{ kind: string; status: string; recipient: string }>(
              `SELECT kind, status, recipient FROM notifications
              WHERE booking_id = $1 AND event_id = ANY($2::uuid[]) ORDER BY kind`,
              [id, [documentEventId(eventId, 'eticket'), documentEventId(eventId, 'invoice')]],
            )
          ).rows,
      ),
    );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const f = app.fixtures;
    const seat = f.seatNumbers[0];
    const quote = await app.post('/pricing/quote', {
      tripId: f.tripId,
      fromStopId: f.fromStopId,
      toStopId: f.toStopId,
      seatType: 'seater',
      seatNumbers: [seat],
    });
    const hold = await app.post(
      '/bookings/hold',
      {
        quoteId: quote.body.quoteId,
        seatNumbers: [seat],
        passengers: [{ seatNumber: seat, fullName: 'Invoice Holder', age: 36, gender: 'female' }],
        contactPhone: f.customer.phone,
        contactEmail: email,
      },
      { idempotencyKey: `e2e-docs-hold-${email}` },
    );
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    bookingId = hold.body.bookingId;
    pnr = hold.body.pnr;
    const pay = await app.post(
      '/payments/charge',
      { bookingId, method: 'upi', vpa: 'success@ticketly' },
      { idempotencyKey: `e2e-docs-pay-${email}` },
    );
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('the e-ticket is emailed once per confirmation event', async () => {
    const tickets = app.nest.get(TicketService);
    expect(await inTenant(() => tickets.emailTicket(bookingId, eventId))).toBe(true);
    // The outbox delivers at least once: a redelivery sends nothing.
    expect(await inTenant(() => tickets.emailTicket(bookingId, eventId))).toBe(false);
    const rows = (await documents(bookingId)).filter((r) => r.kind === 'eticket');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'sent', recipient: email });
  });

  it('the GST invoice is a separate email, also once', async () => {
    const invoices = app.nest.get(InvoiceService);
    const issued = await inTenant(() => invoices.issueForBooking(bookingId));
    expect(issued?.invoiceNumber).toBeTruthy();
    expect(await inTenant(() => invoices.emailInvoice(bookingId, eventId))).toBe(true);
    expect(await inTenant(() => invoices.emailInvoice(bookingId, eventId))).toBe(false);
    const kinds = (await documents(bookingId)).map((r) => r.kind);
    expect(kinds).toEqual(['eticket', 'invoice']);

    const doc = await inTenant(() => invoices.invoiceDocument(bookingId));
    expect(doc).not.toBeNull();
    expect(doc!.recipient.name).toBe('Invoice Holder');
    expect(doc!.pnr).toBe(pnr);
    expect(doc!.placeOfSupply).not.toBe('India');
    // The table foots to the invoice exactly.
    const tax = doc!.rows.reduce((s, r) => s + r.cgstMinor + r.sgstMinor + r.igstMinor, 0);
    expect(tax).toBe(doc!.taxTotalMinor);
    expect(doc!.taxableMinor + doc!.taxTotalMinor + doc!.roundOffMinor).toBe(doc!.totalMinor);
  });

  it('nothing is emailed for a booking without an email, or not yet paid', async () => {
    const tickets = app.nest.get(TicketService);
    const invoices = app.nest.get(InvoiceService);
    const held = await heldBooking(app, app.fixtures.seatNumbers[1], { fullName: 'No Mail' });
    expect(await inTenant(() => tickets.emailTicket(held.bookingId as BookingId, newId()))).toBe(
      false,
    );
    expect(await inTenant(() => invoices.emailInvoice(held.bookingId as BookingId, newId()))).toBe(
      false,
    );
  });

  describe('platform monitoring', () => {
    const feed = '/admin/monitoring/bookings';

    it('is for platform admins only', async () => {
      expect((await app.get(feed, { as: 'operator' })).status).toBe(403);
      expect((await app.get(feed, { as: 'customer' })).status).toBe(403);
      expect((await app.get(`${feed}/activity`, { as: 'operator' })).status).toBe(403);
      expect([401, 403]).toContain((await app.get(feed, { as: 'anonymous' })).status);
    });

    it('shows the booking, its operator and its emails — contacts masked', async () => {
      const r = await app.get(`${feed}?pnr=${pnr.toLowerCase()}`, { as: 'platformAdmin' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const item = r.body.items.find((b: { id: string }) => b.id === bookingId);
      expect(item).toMatchObject({
        pnr,
        status: 'confirmed',
        tenantId: app.fixtures.tenantId,
        emails: { eticket: 'sent', invoice: 'sent' },
      });
      expect(item.operatorName).toBeTruthy();
      expect(item.contactEmail).toMatch(/^do\*\*\*@example\.in$/);
      expect(item.contactPhone).toMatch(/^\d{2}\*+\d{2}$/);
      expect(JSON.stringify(r.body)).not.toContain(email);
      expect(JSON.stringify(r.body)).not.toContain(app.fixtures.customer.phone.slice(-10));
    });

    it('live = a customer paying right now; other operators filter out', async () => {
      const held = await heldBooking(app, app.fixtures.seatNumbers[2], { fullName: 'Paying Now' });
      const live = await app.get(`${feed}?status=live&tenantId=${app.fixtures.tenantId}`, {
        as: 'platformAdmin',
      });
      expect(live.status).toBe(200);
      const row = live.body.items.find((b: { id: string }) => b.id === held.bookingId);
      expect(row).toMatchObject({ liveHold: true, status: 'held' });
      expect(live.body.items.every((b: { liveHold: boolean }) => b.liveHold)).toBe(true);

      const other = await app.get(`${feed}?tenantId=${newId()}`, { as: 'platformAdmin' });
      expect(other.body.items).toEqual([]);

      const activity = await app.get(`${feed}/activity`, { as: 'platformAdmin' });
      expect(activity.status).toBe(200);
      const mine = activity.body.operators.find(
        (o: { tenantId: string }) => o.tenantId === app.fixtures.tenantId,
      );
      expect(mine.holdsLive).toBeGreaterThanOrEqual(1);
      expect(mine.confirmed).toBeGreaterThanOrEqual(1);
      expect(activity.body.totals.holdsLive).toBeGreaterThanOrEqual(mine.holdsLive);
    });

    it('pages without repeats', async () => {
      const first = await app.get(`${feed}?limit=1`, { as: 'platformAdmin' });
      expect(first.body.items).toHaveLength(1);
      expect(first.body.hasMore).toBe(true);
      const next = await app.get(
        `${feed}?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
        { as: 'platformAdmin' },
      );
      expect(next.status).toBe(200);
      expect(next.body.items[0].id).not.toBe(first.body.items[0].id);
    });

    it('rejects bad input with a message', async () => {
      const bad = async (q: string) =>
        (await app.get(`${feed}${q}`, { as: 'platformAdmin' })).status;
      expect(await bad('?cursor=garbage')).toBe(400);
      expect(await bad('?from=2026-10-10&to=2026-10-01')).toBe(400);
      expect(await bad('?from=2026-01-01&to=2026-12-31')).toBe(400);
      expect(await bad('?limit=101')).toBe(400);
      expect(await bad('?status=paid')).toBe(400);
      expect(await bad('?tenantId=nope')).toBe(400);
      expect(await bad('?pnr=%27%20or%201%3D1')).toBe(400);
    });
  });
});
