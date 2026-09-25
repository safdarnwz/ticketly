import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type BookingId, type DomainEvent } from '@kernel';

import { TicketService } from '@api/modules/tickets/application/services/ticket.service';
import { EventDispatcher } from '../dispatcher/event-dispatcher';

/**
 * Emails the e-ticket (journey, passengers, fare, boarding QR) when a booking
 * is confirmed. It replaces the one-line confirmation email: the operator's
 * confirmation email template becomes the ticket's subject and opening text.
 * The GST invoice is a separate email (InvoiceConsumer). Sent once per event.
 */
@Injectable()
export class TicketEmailConsumer implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly tickets: TicketService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({
      eventType: 'booking.confirmed',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        await this.tickets.emailTicket(event.aggregateId as BookingId, event.eventId);
      },
    });
  }
}
