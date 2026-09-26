import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { Permission } from '@contracts';
import {
  AppError,
  ErrorCode,
  getContext,
  getUserId,
  hasPermission,
  NotFoundError,
  requireTenantId,
  type BookingId,
  type SupportTicketId,
  type UserId,
} from '@kernel';

import {
  assertTicketTransition,
  isTicketClosed,
  statusAfterMessage,
  type EscalationStatus,
  type TicketStatus,
} from '../../domain/ticket-state';
import { SupportRepository } from '../../infrastructure/persistence/support.repository';

/**
 * Customer support tickets with a message thread. A ticket is a small state
 * machine (open ⇄ pending → resolved → closed); a reply moves it per who sent
 * it (a customer reply reopens, an agent reply on an open ticket → pending),
 * and an explicit status change is validated against the legal transitions.
 * Reply + status move happen in one transaction so the thread and the ticket
 * state never disagree.
 */
/** Operator staff handle tickets; everyone else is a customer who sees only their own. */
function isStaff(): boolean {
  return Boolean(getContext()?.tenantId) && hasPermission(Permission.BOOKING_READ);
}

@Injectable()
export class SupportService {
  constructor(
    private readonly repo: SupportRepository,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * A customer opens a ticket about their own booking (or none); staff raise
   * one for a caller — the ticket then belongs to the booking's customer.
   */
  async open(input: {
    subject: string;
    body: string;
    category?: string;
    priority?: string;
    bookingId?: BookingId;
    pnr?: string;
  }): Promise<{ ticketId: string }> {
    const staff = isStaff();
    const me = getUserId() ?? null;
    if (!me)
      throw new AppError(ErrorCode.COMMON_UNAUTHENTICATED, 401, { message: 'Sign in first' });
    let bookingId: string | null = null;
    let customerId: string | null = staff ? null : me;
    if (input.bookingId || input.pnr) {
      const b = await this.repo.booking({ id: input.bookingId, pnr: input.pnr });
      // A customer can only raise a ticket about their own booking.
      if (!b || (!staff && b.customerId !== me))
        throw new NotFoundError('Booking', input.pnr ?? input.bookingId ?? '');
      bookingId = b.id;
      if (staff) customerId = b.customerId;
    }
    return this.uow.run({ name: 'support.open', tenantId: requireTenantId() }, async () => {
      const ticketId = await this.repo.createTicket({
        subject: input.subject,
        category: input.category ?? 'general',
        // Customers cannot jump the queue; staff set the priority.
        priority: staff ? (input.priority ?? 'normal') : 'normal',
        customerId: customerId as UserId | null,
        bookingId: bookingId as BookingId | null,
      });
      await this.repo.addMessage({
        ticketId: ticketId as SupportTicketId,
        authorKind: staff ? 'agent' : 'customer',
        authorId: me,
        body: input.body,
      });
      if (staff) await this.repo.update(ticketId as SupportTicketId, { assignedTo: me });
      return { ticketId };
    });
  }

  async reply(
    ticketId: SupportTicketId,
    input: { body: string },
  ): Promise<{ status: TicketStatus }> {
    const staff = isStaff();
    return this.uow.run({ name: 'support.reply', tenantId: requireTenantId() }, async () => {
      const ticket = await this.visible(ticketId, staff);
      if (isTicketClosed(ticket.status)) {
        throw new AppError(ErrorCode.SUPPORT_TICKET_CLOSED, 422, {
          message: 'This ticket is closed — open a new one',
        });
      }
      const authorKind = staff ? 'agent' : 'customer';
      await this.repo.addMessage({
        ticketId,
        authorKind,
        authorId: getUserId() ?? null,
        body: input.body,
      });
      const next = statusAfterMessage(ticket.status, authorKind);
      if (next !== ticket.status) await this.repo.updateStatus(ticketId, next);
      // The first staff member to answer takes the ticket.
      if (staff && !ticket.assignedTo)
        await this.repo.update(ticketId, { assignedTo: getUserId() ?? null });
      return { status: next };
    });
  }

  /** Staff move a ticket through its states; a customer can only close their own. */
  async transition(ticketId: SupportTicketId, to: TicketStatus): Promise<{ status: TicketStatus }> {
    const staff = isStaff();
    return this.uow.run({ name: 'support.transition', tenantId: requireTenantId() }, async () => {
      const ticket = await this.visible(ticketId, staff);
      if (!staff && to !== 'closed')
        throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
          message: 'You can close your ticket; the operator moves it otherwise',
        });
      assertTicketTransition(ticket.status, to);
      if (ticket.status !== to) await this.repo.updateStatus(ticketId, to);
      return { status: to };
    });
  }

  /** Staff: priority and assignee (another staff member of this operator, or nobody). */
  async update(
    ticketId: SupportTicketId,
    patch: { priority?: string; assignedTo?: string | null },
  ): Promise<void> {
    const ticket = await this.visible(ticketId, true);
    if (isTicketClosed(ticket.status))
      throw new AppError(ErrorCode.SUPPORT_TICKET_CLOSED, 422, {
        message: 'This ticket is closed',
      });
    if (patch.assignedTo && !(await this.repo.isStaff(patch.assignedTo)))
      throw new NotFoundError('Staff member', patch.assignedTo);
    await this.repo.update(ticketId, patch);
  }

  async get(ticketId: SupportTicketId): Promise<unknown> {
    await this.visible(ticketId, isStaff());
    const staff = isStaff();
    const [ticket, messages] = await Promise.all([
      this.repo.ticketView(ticketId, staff),
      this.repo.listMessages(ticketId, staff),
    ]);
    return { ticket, messages };
  }

  async list(filter: {
    status?: TicketStatus | 'active';
    priority?: string;
    category?: string;
    assigned?: 'me' | 'none';
    q?: string;
    escalated?: boolean;
    limit: number;
  }): Promise<unknown[]> {
    const staff = isStaff();
    const me = getUserId();
    return this.repo.listTickets({
      ...filter,
      // A customer sees only their own tickets, whatever they ask for.
      customerId: staff ? undefined : ((me ?? '00000000-0000-0000-0000-000000000000') as UserId),
      assignedTo: filter.assigned === 'none' ? 'none' : filter.assigned === 'me' ? me : undefined,
      escalated: staff ? filter.escalated : undefined,
    });
  }

  /**
   * Staff hand a ticket they cannot solve to the platform's support team, with
   * what they tried. A later note re-opens an answered or closed escalation.
   * The note is internal: the customer never sees it.
   */
  async escalate(
    ticketId: SupportTicketId,
    reason: string,
  ): Promise<{ escalationStatus: EscalationStatus }> {
    if (!isStaff())
      throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
        message: "Only the operator's staff can escalate a ticket",
      });
    return this.uow.run({ name: 'support.escalate', tenantId: requireTenantId() }, async () => {
      const ticket = await this.visible(ticketId, true);
      if (isTicketClosed(ticket.status))
        throw new AppError(ErrorCode.SUPPORT_TICKET_CLOSED, 422, {
          message: 'This ticket is closed — open a new one to escalate',
        });
      const me = getUserId() ?? null;
      await this.repo.addMessage({
        ticketId,
        authorKind: 'escalation',
        authorId: me,
        body: reason,
      });
      await this.repo.escalate(ticketId, me);
      return { escalationStatus: 'open' as const };
    });
  }

  // ── Platform support team ──

  listEscalations(filter: { status?: EscalationStatus | 'active'; limit: number }) {
    return this.repo.listEscalations(filter);
  }

  async escalation(ticketId: string) {
    const found = await this.repo.escalation(ticketId);
    if (!found) throw new NotFoundError('Escalation', ticketId);
    return found;
  }

  /** The platform answers the operator; an escalation closed by the platform takes no more replies. */
  async answerEscalation(
    ticketId: string,
    body: string,
  ): Promise<{ escalationStatus: 'answered' }> {
    const before = await this.repo.platformAct(ticketId, {
      reply: { authorId: getUserId() ?? null, body },
    });
    if (!before) throw new NotFoundError('Escalation', ticketId);
    if (before === 'closed')
      throw new AppError(ErrorCode.SUPPORT_TICKET_CLOSED, 422, {
        message: 'This escalation is closed — the operator can escalate again if it comes back',
      });
    return { escalationStatus: 'answered' };
  }

  /** The platform is done with it (closing twice is a no-op). */
  async closeEscalation(ticketId: string): Promise<{ escalationStatus: 'closed' }> {
    if (!(await this.repo.platformAct(ticketId, { close: true })))
      throw new NotFoundError('Escalation', ticketId);
    return { escalationStatus: 'closed' };
  }

  /** The ticket, if this caller may see it (404 otherwise — never a hint it exists). */
  private async visible(ticketId: SupportTicketId, staff: boolean) {
    const ticket = await this.repo.findTicket(ticketId);
    if (!ticket || (!staff && ticket.customerId !== getUserId()))
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Ticket not found' });
    return ticket;
  }
}
