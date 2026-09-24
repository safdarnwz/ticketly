import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, getUserId, requireTenantId, type BookingId, type SupportTicketId, type UserId } from '@kernel';

import { assertTicketTransition, isTicketClosed, statusAfterMessage, type TicketStatus } from '../../domain/ticket-state';
import { SupportRepository } from '../../infrastructure/persistence/support.repository';

/**
 * Customer support tickets with a message thread. A ticket is a small state
 * machine (open ⇄ pending → resolved → closed); a reply moves it per who sent
 * it (a customer reply reopens, an agent reply on an open ticket → pending),
 * and an explicit status change is validated against the legal transitions.
 * Reply + status move happen in one transaction so the thread and the ticket
 * state never disagree.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly repo: SupportRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async open(input: { subject: string; body: string; category?: string; priority?: string; bookingId?: BookingId }): Promise<{ ticketId: string }> {
    return this.uow.run({ name: 'support.open', tenantId: requireTenantId() }, async () => {
      const customerId = (getUserId() ?? null);
      const ticketId = await this.repo.createTicket({
        subject: input.subject,
        category: input.category ?? 'general',
        priority: input.priority ?? 'normal',
        customerId,
        bookingId: input.bookingId ?? null,
      });
      await this.repo.addMessage({ ticketId: ticketId as SupportTicketId, authorKind: 'customer', authorId: customerId, body: input.body });
      return { ticketId };
    });
  }

  async reply(ticketId: SupportTicketId, input: { authorKind: 'customer' | 'agent' | 'system'; body: string }): Promise<{ status: TicketStatus }> {
    return this.uow.run({ name: 'support.reply', tenantId: requireTenantId() }, async () => {
      const ticket = await this.repo.findTicket(ticketId);
      if (!ticket) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Ticket not found' });
      if (isTicketClosed(ticket.status)) {
        throw new AppError(ErrorCode.SUPPORT_TICKET_CLOSED, 422, { message: 'Cannot reply to a closed ticket' });
      }
      const authorId = (getUserId() ?? null);
      await this.repo.addMessage({ ticketId, authorKind: input.authorKind, authorId, body: input.body });

      const next = statusAfterMessage(ticket.status, input.authorKind);
      if (next !== ticket.status) await this.repo.updateStatus(ticketId, next);
      return { status: next };
    });
  }

  async transition(ticketId: SupportTicketId, to: TicketStatus): Promise<{ status: TicketStatus }> {
    return this.uow.run({ name: 'support.transition', tenantId: requireTenantId() }, async () => {
      const ticket = await this.repo.findTicket(ticketId);
      if (!ticket) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Ticket not found' });
      assertTicketTransition(ticket.status, to);
      if (ticket.status !== to) await this.repo.updateStatus(ticketId, to);
      return { status: to };
    });
  }

  async get(ticketId: SupportTicketId): Promise<unknown> {
    const ticket = await this.repo.findTicket(ticketId);
    if (!ticket) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Ticket not found' });
    const messages = await this.repo.listMessages(ticketId);
    return { ticket, messages };
  }

  async list(filter: { customerId?: UserId; status?: TicketStatus; limit?: number }): Promise<unknown[]> {
    return this.repo.listTickets(filter);
  }
}
