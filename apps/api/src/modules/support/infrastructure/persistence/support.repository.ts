import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService, UnitOfWork } from '@database';
import { newId, requireTenantId, type BookingId, type SupportTicketId, type UserId } from '@kernel';

import {
  INTERNAL_AUTHOR_KINDS,
  type EscalationStatus,
  type TicketStatus,
} from '../../domain/ticket-state';

const INTERNAL = `(${INTERNAL_AUTHOR_KINDS.map((k) => `'${k}'`).join(',')})`;

export interface TicketRow {
  id: SupportTicketId;
  status: TicketStatus;
  subject: string;
  category: string;
  priority: string;
  customerId: string | null;
  bookingId: string | null;
  assignedTo: string | null;
  escalationStatus: EscalationStatus | null;
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
  escalationStatus: EscalationStatus | null;
  escalatedAt: string | null;
  lastAuthor: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class SupportRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

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
                        assigned_to AS "assignedTo", escalation_status AS "escalationStatus"
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

  /** The thread; notes between the operator and the platform only for staff. */
  async listMessages(ticketId: SupportTicketId, internal: boolean): Promise<unknown[]> {
    return this.db.query(
      `SELECT m.id, m.author_kind AS "authorKind", m.author_id AS "authorId", u.full_name AS "authorName",
              m.body, m.created_at AS "createdAt"
         FROM support_messages m LEFT JOIN users u ON u.id = m.author_id
        WHERE m.tenant_id = $1 AND m.ticket_id = $2
          ${internal ? '' : `AND m.author_kind NOT IN ${INTERNAL}`}
        ORDER BY m.created_at`,
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
    /** Only tickets escalated to the platform (not closed there). */
    escalated?: boolean;
    limit: number;
  }): Promise<TicketListRow[]> {
    // Customers never see the operator ↔ platform notes, not even their count.
    const visible = filter.customerId ? `AND m.author_kind NOT IN ${INTERNAL}` : '';
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
    if (filter.escalated) conds.push(`t.escalation_status IN ('open','answered')`);
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
              (SELECT count(*)::int FROM support_messages m WHERE m.ticket_id = t.id ${visible}) AS messages,
              ${filter.customerId ? 'NULL' : 't.escalation_status'} AS "escalationStatus",
              ${filter.customerId ? 'NULL' : 't.escalated_at'} AS "escalatedAt",
              lm.author_kind AS "lastAuthor", lm.created_at AS "lastMessageAt",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
         FROM support_tickets t
         LEFT JOIN bookings b ON b.id = t.booking_id
         LEFT JOIN users cu ON cu.id = t.customer_id
         LEFT JOIN users au ON au.id = t.assigned_to
         LEFT JOIN LATERAL (SELECT author_kind, created_at FROM support_messages m
                             WHERE m.ticket_id = t.id ${visible} ORDER BY created_at DESC LIMIT 1) lm ON true
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
  async ticketView(ticketId: SupportTicketId, internal: boolean): Promise<TicketListRow | null> {
    const rows = await this.db.query<TicketListRow>(
      `SELECT t.id, t.subject, t.category, t.priority, t.status, b.pnr, t.booking_id AS "bookingId",
              cu.full_name AS "customerName", b.contact_phone AS "customerPhone",
              t.assigned_to AS "assignedTo", au.full_name AS "assignedName",
              0 AS messages, NULL AS "lastAuthor", NULL AS "lastMessageAt",
              CASE WHEN $3 THEN t.escalation_status END AS "escalationStatus",
              CASE WHEN $3 THEN t.escalated_at END AS "escalatedAt",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
         FROM support_tickets t
         LEFT JOIN bookings b ON b.id = t.booking_id
         LEFT JOIN users cu ON cu.id = t.customer_id
         LEFT JOIN users au ON au.id = t.assigned_to
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), ticketId, internal],
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

  /** Escalate (or re-escalate) to the platform: waiting on the platform again. */
  async escalate(ticketId: SupportTicketId, by: UserId | null): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('escalate must run inside a transaction');
    await scope.client.query(
      `UPDATE support_tickets
          SET escalated_at = CASE WHEN escalation_status IN ('open','answered') THEN escalated_at ELSE now() END,
              escalated_by = CASE WHEN escalation_status IN ('open','answered') THEN escalated_by ELSE $3 END,
              escalation_status = 'open', escalation_closed_at = NULL, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), ticketId, by],
    );
  }

  // ── Platform side: every operator's escalations (RLS bypassed, platform admins only) ──

  /** Escalations across operators, those waiting on the platform first. */
  async listEscalations(filter: {
    status?: EscalationStatus | 'active';
    limit: number;
  }): Promise<EscalationRow[]> {
    return this.uow.run(
      { name: 'support.listEscalations', readOnly: true, bypassRls: true },
      async (s) =>
        (
          await s.client.query<EscalationRow>(
            `SELECT t.id, t.tenant_id AS "tenantId", tn.display_name AS "operatorName", t.subject, t.category,
                    t.priority, t.status, t.escalation_status AS "escalationStatus",
                    t.escalated_at AS "escalatedAt", eu.full_name AS "escalatedByName",
                    b.pnr, lm.author_kind AS "lastAuthor", lm.created_at AS "lastMessageAt"
               FROM support_tickets t
               JOIN tenants tn ON tn.id = t.tenant_id
               LEFT JOIN users eu ON eu.id = t.escalated_by
               LEFT JOIN bookings b ON b.id = t.booking_id
               LEFT JOIN LATERAL (SELECT author_kind, created_at FROM support_messages m
                                   WHERE m.ticket_id = t.id AND m.author_kind IN ${INTERNAL}
                                   ORDER BY created_at DESC LIMIT 1) lm ON true
              WHERE t.escalation_status IS NOT NULL
                AND CASE WHEN $1::text IS NULL OR $1 = 'active' THEN t.escalation_status IN ('open','answered')
                         ELSE t.escalation_status = $1 END
              ORDER BY (t.escalation_status = 'open') DESC,
                       array_position(ARRAY['urgent','high','normal','low'], t.priority),
                       t.escalated_at ASC
              LIMIT $2`,
            [filter.status ?? null, filter.limit],
          )
        ).rows,
    );
  }

  /** One escalated ticket with its whole thread (the platform needs the context). */
  async escalation(
    ticketId: string,
  ): Promise<{ ticket: EscalationRow; messages: unknown[] } | null> {
    return this.uow.run(
      { name: 'support.escalation', readOnly: true, bypassRls: true },
      async (s) => {
        const t = await s.client.query<EscalationRow>(
          `SELECT t.id, t.tenant_id AS "tenantId", tn.display_name AS "operatorName", t.subject, t.category,
                  t.priority, t.status, t.escalation_status AS "escalationStatus",
                  t.escalated_at AS "escalatedAt", eu.full_name AS "escalatedByName", b.pnr,
                  NULL AS "lastAuthor", NULL AS "lastMessageAt"
             FROM support_tickets t
             JOIN tenants tn ON tn.id = t.tenant_id
             LEFT JOIN users eu ON eu.id = t.escalated_by
             LEFT JOIN bookings b ON b.id = t.booking_id
            WHERE t.id = $1 AND t.escalation_status IS NOT NULL`,
          [ticketId],
        );
        if (!t.rows[0]) return null;
        const m = await s.client.query(
          `SELECT m.id, m.author_kind AS "authorKind", u.full_name AS "authorName", m.body,
                  m.created_at AS "createdAt"
             FROM support_messages m LEFT JOIN users u ON u.id = m.author_id
            WHERE m.ticket_id = $1 ORDER BY m.created_at`,
          [ticketId],
        );
        return { ticket: t.rows[0], messages: m.rows };
      },
    );
  }

  /**
   * The platform answers (or closes) an escalation. Locked so a reply never
   * lands on an escalation closed a moment earlier. Returns the status before
   * the change, or null when the ticket is not escalated.
   */
  async platformAct(
    ticketId: string,
    act: { reply: { authorId: string | null; body: string } } | { close: true },
  ): Promise<EscalationStatus | null> {
    return this.uow.run({ name: 'support.platformAct', bypassRls: true }, async (s) => {
      const t = await s.client.query<{ tenant_id: string; escalation_status: EscalationStatus }>(
        `SELECT tenant_id, escalation_status FROM support_tickets
          WHERE id = $1 AND escalation_status IS NOT NULL FOR UPDATE`,
        [ticketId],
      );
      const row = t.rows[0];
      if (!row) return null;
      if ('reply' in act) {
        if (row.escalation_status === 'closed') return row.escalation_status;
        await s.client.query(
          `INSERT INTO support_messages (id, tenant_id, ticket_id, author_kind, author_id, body)
           VALUES ($1, $2, $3, 'platform', $4, $5)`,
          [newId(), row.tenant_id, ticketId, act.reply.authorId, act.reply.body],
        );
        await s.client.query(
          `UPDATE support_tickets SET escalation_status = 'answered', updated_at = now() WHERE id = $1`,
          [ticketId],
        );
      } else if (row.escalation_status !== 'closed') {
        await s.client.query(
          `UPDATE support_tickets SET escalation_status = 'closed', escalation_closed_at = now(),
                  updated_at = now() WHERE id = $1`,
          [ticketId],
        );
      }
      return row.escalation_status;
    });
  }
}

export interface EscalationRow {
  id: string;
  tenantId: string;
  operatorName: string;
  subject: string;
  category: string;
  priority: string;
  status: TicketStatus;
  escalationStatus: EscalationStatus;
  escalatedAt: string;
  escalatedByName: string | null;
  pnr: string | null;
  lastAuthor: string | null;
  lastMessageAt: string | null;
}
