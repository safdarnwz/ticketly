import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * Customer self-service seat upgrade: no login, the booking's contact mobile
 * proves ownership (like self-cancel), and only that booking's tickets can be
 * upgraded.
 */
describe('seat upgrade, customer self-service (e2e)', () => {
  let app: TestApp;
  let mine: { bookingId: string; ticketId: string };
  let othersTicketId: string;

  const firstTicketId = async (bookingId: string): Promise<string> => {
    const t = await app.get(`/bookings/${bookingId}/tickets`, { as: 'operator' });
    return t.body.tickets[0].ticketId as string;
  };

  beforeAll(async () => {
    app = await bootstrapTestApp();
    const a = await confirmedBooking(app, app.fixtures.seatNumbers[0], {
      fullName: 'Upgrade Mine',
    });
    const b = await confirmedBooking(app, app.fixtures.seatNumbers[1], {
      fullName: 'Someone Else',
    });
    mine = { bookingId: a.bookingId, ticketId: await firstTicketId(a.bookingId) };
    othersTicketId = await firstTicketId(b.bookingId);
  });
  afterAll(async () => {
    await app.close();
  });

  const upgrade = (body: Record<string, string>, key: string) =>
    app.post('/payments/upgrade-seat/self', body, { as: 'anonymous', idempotencyKey: key });

  it('refuses a mobile that is not the booking contact', async () => {
    const res = await upgrade(
      { ...mine, mobile: '9000000000', toSeatNumber: app.fixtures.seatNumbers[2] },
      `e2e-upg-wrong-${mine.bookingId}`,
    );
    expect(res.status).toBe(400);
  });

  it("refuses another booking's ticket, even with a valid mobile", async () => {
    const res = await upgrade(
      {
        bookingId: mine.bookingId,
        ticketId: othersTicketId,
        mobile: app.fixtures.customer.phone,
        toSeatNumber: app.fixtures.seatNumbers[2],
      },
      `e2e-upg-other-${mine.bookingId}`,
    );
    expect(res.status).toBe(404);
  });

  it('reaches the upgrade rules for the owner (same fare is not an upgrade)', async () => {
    const res = await upgrade(
      { ...mine, mobile: app.fixtures.customer.phone, toSeatNumber: app.fixtures.seatNumbers[2] },
      `e2e-upg-own-${mine.bookingId}`,
    );
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.detail).toContain('not an upgrade');
  });
});
