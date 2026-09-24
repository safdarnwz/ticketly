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
}

@Injectable()
export class SupportRepository {
  constructor(private readonly db: DatabaseService) {}

  async createTicket(input: {
    subject: string; category: string; priority: string; customerId: UserId | null; bookingId: BookingId | null;
  }): Promise<string> {
    const id = newId();
    const scope = currentTransaction();
    const sql = `INSERT INTO support_tickets (id, tenant_id, booking_id, customer_id, subject, category, priority)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`;
    const params = [id, requireTenantId(), input.bookingId, input.customerId, input.subject, input.category, input.priority];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'support.createTicket', primary: true });
    return id;
  }

  async findTicket(ticketId: SupportTicketId): Promise<TicketRow | null> {
    const scope = currentTransaction();
    const sql = `SELECT id, status, subject, category, priority, customer_id AS "customerId", booking_id AS "bookingId"
                   FROM support_tickets WHERE tenant_id = $1 AND id = $2${scope ? ' FOR UPDATE' : ''}`;
    if (scope) return (await scope.client.query<TicketRow>(sql, [requireTenantId(), ticketId])).rows[0] ?? null;
    return this.db.queryOne<TicketRow>(sql, [requireTenantId(), ticketId], { name: 'support.findTicket', primary: true });
  }

  async addMessage(input: { ticketId: SupportTicketId; authorKind: string; authorId: UserId | null; body: string }): Promise<string> {
    const id = newId();
    const scope = currentTransaction();
    const sql = `INSERT INTO support_messages (id, tenant_id, ticket_id, author_kind, author_id, body)
                 VALUES ($1,$2,$3,$4,$5,$6)`;
    const params = [id, requireTenantId(), input.ticketId, input.authorKind, input.authorId, input.body];
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
      `SELECT author_kind AS "authorKind", author_id AS "authorId", body, created_at AS "createdAt"
         FROM support_messages WHERE tenant_id = $1 AND ticket_id = $2 ORDER BY created_at`,
      [requireTenantId(), ticketId],
      { name: 'support.listMessages' },
    );
  }

  async listTickets(filter: { customerId?: UserId; status?: TicketStatus; limit?: number }): Promise<unknown[]> {
    const conds = ['tenant_id = $1'];
    const params: unknown[] = [requireTenantId()];
    if (filter.customerId) { params.push(filter.customerId); conds.push(`customer_id = $${params.length}`); }
    if (filter.status) { params.push(filter.status); conds.push(`status = $${params.length}`); }
    params.push(Math.min(filter.limit ?? 50, 200));
    return this.db.query(
      `SELECT id, subject, category, priority, status, created_at AS "createdAt", updated_at AS "updatedAt"
         FROM support_tickets WHERE ${conds.join(' AND ')} ORDER BY updated_at DESC LIMIT $${params.length}`,
      params,
      { name: 'support.listTickets' },
    );
  }
}
