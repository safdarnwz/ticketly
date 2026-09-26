import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapTestApp, type TestApp } from './support/bootstrap';
import { confirmedBooking } from './support/flows';

/**
 * Support tickets. Customers could not open one at all (a staff permission was
 * required), anyone with that permission could read every ticket, and the
 * request said who wrote a message — so a customer could post as "agent".
 * Now customers see only their own tickets, staff work all of the operator's,
 * and the author is whoever is signed in.
 */
describe('support tickets (e2e)', () => {
  let app: TestApp;
  let otherOperator: Record<string, string>;
  let otherStaffId: string;
  let booking: { bookingId: string; pnr: string };
  const op = { as: 'operator' as const };
  const customer = {}; // the default principal

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
    otherStaffId = (await app.get('/auth/me', { headers: otherOperator })).body.userId;
    booking = await confirmedBooking(app, app.fixtures.seatNumbers[1], {
      fullName: 'Ticket Raiser',
      age: 40,
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const open = (body: object, opts: object = customer) =>
    app.post(
      '/support/tickets',
      { subject: 'AC not working', body: 'The AC was off all night', ...body },
      opts,
    );
  const get = (id: string, opts: object = customer) => app.get(`/support/tickets/${id}`, opts);

  it('a customer opens and follows their own ticket only', async () => {
    expect((await open({}, { as: 'anonymous' })).status).toBe(401);
    expect((await open({ subject: 'x' })).status).toBe(400);
    expect((await open({ bookingId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);

    const t = await open({ bookingId: booking.bookingId, priority: 'urgent', category: 'refund' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body.ticketId as string;
    const view = await get(id);
    expect(view.status).toBe(200);
    expect(view.body.ticket).toMatchObject({
      pnr: booking.pnr,
      priority: 'normal',
      status: 'open',
    });

    // The author comes from the account — "agent" in the body is ignored.
    await app.post(`/support/tickets/${id}/messages`, { body: 'Any update?', authorKind: 'agent' });
    const thread = (await get(id)).body.messages as { authorKind: string }[];
    expect(thread.map((m) => m.authorKind)).toEqual(['customer', 'customer']);

    // Staff raise one for a caller without a booking: not the customer's to see.
    const staffOnly = await open({ subject: 'Caller asked about luggage' }, op);
    expect(staffOnly.status).toBe(201);
    expect((await get(staffOnly.body.ticketId)).status).toBe(404);
    const mine = (await app.get('/support/tickets')).body.tickets as { id: string }[];
    expect(mine.some((x) => x.id === id)).toBe(true);
    expect(mine.some((x) => x.id === staffOnly.body.ticketId)).toBe(false);

    // A customer may close their ticket, not resolve it; a closed ticket takes no replies.
    expect((await app.post(`/support/tickets/${id}/status`, { status: 'resolved' })).status).toBe(
      403,
    );
    expect((await app.post(`/support/tickets/${id}/status`, { status: 'closed' })).status).toBe(
      200,
    );
    const late = await app.post(`/support/tickets/${id}/messages`, { body: 'hello?' });
    expect(late.status).toBe(422);
  });

  it('staff work every ticket of their operator, and only theirs', async () => {
    const t = await open(
      { pnr: booking.pnr, subject: 'Caller: refund not received', priority: 'high' },
      op,
    );
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body.ticketId as string;
    // Raised for the booking's customer: they see it too.
    expect((await get(id)).status).toBe(200);
    const staffView = await get(id, op);
    expect(staffView.body.ticket).toMatchObject({ priority: 'high', pnr: booking.pnr });
    expect(staffView.body.ticket.assignedTo).toBeTruthy(); // taken by whoever raised it

    const reply = await app.post(
      `/support/tickets/${id}/messages`,
      { body: 'Refund sent today' },
      op,
    );
    expect(reply.body.status).toBe('pending');
    const customerReply = await app.post(`/support/tickets/${id}/messages`, {
      body: 'Thanks, got it',
    });
    expect(customerReply.body.status).toBe('open');

    const patch = (body: object, headers?: Record<string, string>) =>
      app.patch(`/support/tickets/${id}`, body, headers ? { headers } : op);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ assignedTo: otherStaffId })).status).toBe(404);
    expect((await patch({ priority: 'urgent', assignedTo: null })).status).toBe(200);
    const unassigned = (await app.get('/support/tickets?assigned=none&status=active', op)).body
      .tickets as { id: string; priority: string }[];
    expect(unassigned.find((x) => x.id === id)?.priority).toBe('urgent');
    expect((await patch({ priority: 'low' }, otherOperator)).status).toBe(404);
    expect((await get(id, { headers: otherOperator })).status).toBe(404);
    expect(
      (
        (await app.get('/support/tickets', { headers: otherOperator })).body.tickets as {
          id: string;
        }[]
      ).some((x) => x.id === id),
    ).toBe(false);
    // The customer cannot re-prioritise.
    expect((await app.patch(`/support/tickets/${id}`, { priority: 'urgent' })).status).toBe(403);

    expect(
      (await app.post(`/support/tickets/${id}/status`, { status: 'resolved' }, op)).status,
    ).toBe(200);
    const byPnr = (await app.get(`/support/tickets?q=${booking.pnr.toLowerCase()}`, op)).body
      .tickets as { id: string }[];
    expect(byPnr.some((x) => x.id === id)).toBe(true);
  });

  it('staff escalate to the platform; the notes stay internal; the platform answers and closes', async () => {
    const t = await open({ pnr: booking.pnr, subject: 'Payment taken, no ticket' }, op);
    const id = t.body.ticketId as string;
    const escalate = (body: object, key: string, opts: object = op) =>
      app.post(`/support/tickets/${id}/escalate`, body, {
        ...opts,
        idempotencyKey: `e2e-esc-${key}-${id}`,
      });
    const why = { reason: 'Gateway shows captured, booking still held — please check' };

    expect((await escalate({ reason: 'help' }, 'short')).status).toBe(400);
    expect((await escalate(why, 'cust', customer)).status).toBe(403);
    expect((await escalate(why, 'other', { headers: otherOperator })).status).toBe(404);
    expect(
      (
        await app.post('/support/tickets/00000000-0000-4000-8000-000000000000/escalate', why, {
          ...op,
          idempotencyKey: `e2e-esc-unknown-${id}`,
        })
      ).status,
    ).toBe(404);
    const first = await escalate(why, 'one');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.escalationStatus).toBe('open');
    await escalate(why, 'one'); // a double click posts the note once

    const staffView = await get(id, op);
    expect(staffView.body.ticket.escalationStatus).toBe('open');
    const notes = (staffView.body.messages as { authorKind: string }[]).filter(
      (m) => m.authorKind === 'escalation',
    );
    expect(notes).toHaveLength(1);
    // The customer sees neither the note nor that it was escalated.
    const custView = await get(id);
    expect(
      (custView.body.messages as { authorKind: string }[]).map((m) => m.authorKind),
    ).not.toContain('escalation');
    expect(custView.body.ticket.escalationStatus).toBeNull();
    const escalatedOnly = (await app.get('/support/tickets?escalated=1', op)).body.tickets as {
      id: string;
    }[];
    expect(escalatedOnly.some((x) => x.id === id)).toBe(true);

    // The platform desk: operators cannot reach it; the platform sees and answers.
    const admin = { as: 'platformAdmin' as const };
    expect((await app.get('/admin/support/escalations', op)).status).toBe(403);
    const desk = await app.get('/admin/support/escalations', admin);
    expect(desk.status, JSON.stringify(desk.body)).toBe(200);
    expect(desk.body.items.find((x: { id: string }) => x.id === id)).toMatchObject({
      escalationStatus: 'open',
      operatorName: expect.any(String),
    });
    const thread = await app.get(`/admin/support/escalations/${id}`, admin);
    expect(thread.body.messages.length).toBeGreaterThanOrEqual(2);
    expect(
      (await app.get('/admin/support/escalations/00000000-0000-4000-8000-000000000000', admin))
        .status,
    ).toBe(404);
    const answer = (body: string) =>
      app.post(`/admin/support/escalations/${id}/messages`, { body }, admin);
    expect((await answer('')).status).toBe(400);
    expect((await answer('Payment re-linked; ticket issued')).body.escalationStatus).toBe(
      'answered',
    );
    const afterAnswer = await get(id, op);
    expect(afterAnswer.body.ticket.escalationStatus).toBe('answered');
    expect(
      (afterAnswer.body.messages as { authorKind: string }[]).some(
        (m) => m.authorKind === 'platform',
      ),
    ).toBe(true);
    expect(
      ((await get(id)).body.messages as { authorKind: string }[]).map((m) => m.authorKind),
    ).not.toContain('platform');

    const close = () => app.post(`/admin/support/escalations/${id}/close`, {}, admin);
    expect((await close()).status).toBe(200);
    expect((await close()).status).toBe(200);
    expect((await answer('One more thing')).status).toBe(422);
    // It comes back: the operator escalates again.
    expect((await escalate({ reason: 'Happened again on the next booking' }, 'two')).body).toEqual({
      escalationStatus: 'open',
    });

    // A closed ticket cannot be escalated.
    expect((await app.post(`/support/tickets/${id}/status`, { status: 'closed' }, op)).status).toBe(
      200,
    );
    expect((await escalate(why, 'closed')).status).toBe(422);
  });
});
