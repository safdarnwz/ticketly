import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type BookingId, type DomainEvent } from '@kernel';

import { InvoiceService } from '@api/modules/invoicing/application/services/invoice.service';
import { TenantRepository } from '@api/modules/tenancy/infrastructure/persistence/tenant.repository';
import { EventDispatcher } from '../dispatcher/event-dispatcher';

/**
 * Raises GST documents off the booking lifecycle: a tax invoice when a booking
 * is confirmed, a credit note when it is cancelled. Living in the worker (not
 * the booking flow) keeps invoicing a bolt-on the booking module never knew
 * about. Idempotent: the invoice service is a no-op if the document already
 * exists / the booking is not confirmed, which is required because the outbox
 * delivers at-least-once.
 */
@Injectable()
export class InvoiceConsumer implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly invoices: InvoiceService,
    private readonly tenants: TenantRepository,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register({
      eventType: 'booking.confirmed',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        // The operator's GSTIN, captured at onboarding approval (migration
        // 0036) — CGST Rule 46's mandatory supplier field. Without this, the
        // ONLY code path that actually issues tax invoices (this one; the
        // controller's manual path is for reissue/reference only) produced
        // documents missing one of the required fields on every invoice.
        const gst = await this.tenants.getGstDetails(event.tenantId);
        const result = await this.invoices.issueForBooking(
          event.aggregateId as BookingId,
          gst?.gstin ?? undefined,
        );
        // Its own email (the e-ticket is another). Sent once per event; a
        // mail-server failure throws so the outbox redelivers — the invoice
        // above is not issued twice (issueForBooking is idempotent).
        if (result) await this.invoices.emailInvoice(event.aggregateId as BookingId, event.eventId);
      },
    });
    this.dispatcher.register({
      eventType: 'booking.cancelled',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        await this.invoices.creditNoteForBooking(event.aggregateId as BookingId);
      },
    });
  }
}
