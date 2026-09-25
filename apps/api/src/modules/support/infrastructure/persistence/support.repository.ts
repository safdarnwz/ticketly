import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { newId, requireTenantId, type BookingId, type SupportTicketId, type UserId } from '@kernel';

import type { TicketStatus } from '../../domain/ticket-state';

export interface TicketRow {
  id: SupportTicketId;
  status: TicketStatus;
  subject: string;
  category: string;
  priority: string;
  customerId: string | null;
  bookingId: string | null;
  assignedTo: string | null;
}

export interface TicketListRow {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: TicketStatus;
  pnr: string | null;
  bookingId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  messages: number;
  lastAuthor: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SupportRepository {
  constructor(private readonly db: DatabaseService) {}

  async createTicket(input: {
    subject: string;
    category: string;
    priority: string;
    customerId: UserId | null;
    bookingId: BookingId | null;
  }): Promise<string> {
    const id = newId();
    const scope = currentTransaction();
    const sql = `INSERT INTO support_tickets (id, tenant_id, booking_id, customer_id, subject, category, priority)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`;
    const params = [
      id,
      requireTenantId(),
      input.bookingId,
      input.customerId,
      input.subject,
      input.category,
      input.priority,
    ];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'support.createTicket', primary: true });
    return id;
  }

  async findTicket(ticketId: SupportTicketId): Promise<TicketRow | null> {
    const scope = currentTransaction();
    const sql = `SELECT id, status, subject, category, priority, customer_id AS "customerId", booking_id AS "bookingId",
                        assigned_to AS "assignedTo"
                   FROM support_tickets WHERE tenant_id = $1 AND id = $2${scope ? ' FOR UPDATE' : ''}`;
    if (scope)
      return (
        (await scope.client.query<TicketRow>(sql, [requireTenantId(), ticketId])).rows[0] ?? null
      );
    return this.db.queryOne<TicketRow>(sql, [requireTenantId(), ticketId], {
      name: 'support.findTicket',
      primary: true,
    });
  }

  async addMessage(input: {
    ticketId: SupportTicketId;
    authorKind: string;
    authorId: UserId | null;
    body: string;
  }): Promise<string> {
    const id = newId();
    const scope = currentTransaction();
    const sql = `INSERT INTO support_messages (id, tenant_id, ticket_id, author_kind, author_id, body)
                 VALUES ($1,$2,$3,$4,$5,$6)`;
    const params = [
      id,
      requireTenantId(),
      input.ticketId,
      input.authorKind,
      input.authorId,
      input.body,
    ];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'support.addMessage', primary: true });
    return id;
  }

  async updateStatus(ticketId: SupportTicketId, status: TicketStatus): Promise<void> {
    const scope = currentTransaction();
    const sql = `UPDATE support_tickets SET status = $3,
                   resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE resolved_at END,
                   closed_at   = CASE WHEN $3 = 'closed'   THEN now() ELSE closed_at END,
                   updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`;
    const params = [requireTenantId(), ticketId, status];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'support.updateStatus', primary: true });
  }

  async listMessages(ticketId: SupportTicketId): Promise<unknown[]> {
    return this.db.query(
      `SELECT m.id, m.author_kind AS "authorKind", m.author_id AS "authorId", u.full_name AS "authorName",
              m.body, m.created_at AS "createdAt"
         FROM support_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.tenant_id = $1 AND m.ticket_id = $2 ORDER BY m.created_at`,
      [requireTenantId(), ticketId],
      { name: 'support.listMessages' },
    );
  }

  /**
   * Tickets, most urgent first: active ones (open, then waiting on the
   * customer) by priority and age, then the rest by last update.
   */
  async listTickets(filter: {
    customerId?: UserId;
    status?: TicketStatus | 'active';
    priority?: string;
    category?: string;
    /** A staff user id, or 'none' for unassigned. */
    assignedTo?: string;
    q?: string;
    limit: number;
  }): Promise<TicketListRow[]> {
    const conds = ['t.tenant_id = $1'];
    const params: unknown[] = [requireTenantId()];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      conds.push(sql.replace('?', `$${params.length}`));
    };
    if (filter.customerId) add('t.customer_id = ?', filter.customerId);
    if (filter.status === 'active') conds.push(`t.status IN ('open','pending')`);
    else if (filter.status) add('t.status = ?', filter.status);
    if (filter.priority) add('t.priority = ?', filter.priority);
    if (filter.category) add('t.category = ?', filter.category);
    if (filter.assignedTo === 'none') conds.push('t.assigned_to IS NULL');
    else if (filter.assignedTo) add('t.assigned_to = ?', filter.assignedTo);
    if (filter.q) {
      params.push(filter.q);
      const n = params.length;
      conds.push(`(t.subject ILIKE '%' || $${n} || '%' OR b.pnr = upper($${n}))`);
    }
    params.push(filter.limit);
    return this.db.query<TicketListRow>(
      `SELECT t.id, t.subject, t.category, t.priority, t.status, b.pnr, t.booking_id AS "bookingId",
              cu.full_name AS "customerName", b.contact_phone AS "customerPhone",
              t.assigned_to AS "assignedTo", au.full_name AS "assignedName",
              (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id) AS messages,
              lm.author_kind AS "lastAuthor", lm.created_at AS "lastMessageAt",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
         FROM support_tickets t
         LEFT JOIN bookings b ON b.id = t.booking_id
         LEFT JOIN users cu ON cu.id = t.customer_id
         LEFT JOIN users au ON au.id = t.assigned_to
         LEFT JOIN LATERAL (SELECT author_kind, created_at FROM support_messages m
                             WHERE m.ticket_id = t.id ORDER BY created_at DESC LIMIT 1) lm ON true
        WHERE ${conds.join(' AND ')}
        ORDER BY (t.status IN ('open','pending')) DESC, (t.status = 'open') DESC,
                 array_position(ARRAY['urgent','high','normal','low'], t.priority),
                 CASE WHEN t.status IN ('open','pending') THEN t.created_at END ASC,
                 t.updated_at DESC
        LIMIT $${params.length}`,
      params,
      { name: 'support.listTickets' },
    );
  }

  /** One ticket's header for its page: booking, customer, assignee. */
  async ticketView(ticketId: SupportTicketId): Promise<TicketListRow | null> {
    const rows = await this.db.query<TicketListRow>(
      `SELECT t.id, t.subject, t.category, t.priority, t.status, b.pnr, t.booking_id AS "bookingId",
              cu.full_name AS "customerName", b.contact_phone AS "customerPhone",
              t.assigned_to AS "assignedTo", au.full_name AS "assignedName",
              0 AS messages, NULL AS "lastAuthor", NULL AS "lastMessageAt",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
         FROM support_tickets t
         LEFT JOIN bookings b ON b.id = t.booking_id
         LEFT JOIN users cu ON cu.id = t.customer_id
         LEFT JOIN users au ON au.id = t.assigned_to
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), ticketId],
      { name: 'support.ticketView' },
    );
    return rows[0] ?? null;
  }

  async update(
    ticketId: SupportTicketId,
    patch: { priority?: string; assignedTo?: string | null },
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE support_tickets
          SET priority = coalesce($3, priority),
              assigned_to = CASE WHEN $4 THEN $5::uuid ELSE assigned_to END,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        requireTenantId(),
        ticketId,
        patch.priority ?? null,
        patch.assignedTo !== undefined,
        patch.assignedTo ?? null,
      ],
      { name: 'support.update', primary: true },
    );
  }

  /** Staff of this operator (who a ticket can be assigned to). */
  async isStaff(userId: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM users WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), userId],
      { name: 'support.isStaff', primary: true },
    );
    return !!row;
  }

  /** A booking of this operator by PNR or id, with its customer. */
  async booking(ref: {
    id?: string;
    pnr?: string;
  }): Promise<{ id: string; customerId: string | null } | null> {
    return this.db.queryOne(
      `SELECT id, customer_id AS "customerId" FROM bookings
        WHERE tenant_id = $1 AND (($2::uuid IS NOT NULL AND id = $2) OR ($3::text IS NOT NULL AND pnr = $3))`,
      [requireTenantId(), ref.id ?? null, ref.pnr ?? null],
      { name: 'support.booking', primary: true },
    );
  }
}
