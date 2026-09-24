import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type BookingId, type DomainEvent } from '@kernel';

import { RefundService } from '@api/modules/refunds/application/services/refund.service';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

/**
 * Initiates the customer refund when a booking is cancelled. Refund-to-source
 * (the original payment method) unless the customer explicitly chose, at
 * cancel time, to receive it into a different bank account they supplied —
 * BookingService.cancel/cancelSeats carry that choice straight through on
 * the event payload, so this consumer only ever forwards it, never invents
 * a default of its own. Idempotent — the refund service returns the
 * existing refund for a booking rather than double-refunding, which is
 * required because the outbox delivers at-least-once.
 */
@Injectable()
export class RefundConsumer implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly refunds: RefundService,
  ) {}

  onModuleInit(): void {
    this.dispatcher.register(this.handler());
    this.dispatcher.register(this.partialHandler());
    this.dispatcher.register(this.gatewayUpdateHandler());
  }

  /**
   * The PSP's refund.processed / refund.failed webhook (routed here from
   * PaymentService.handleWebhook) — settles or fails the refund and posts the
   * refund ledger entry. Before this, a gateway refund stayed 'processing'
   * forever unless staff reconciled it by hand. Idempotent: an already
   * terminal refund is a no-op inside reconcileGatewayEvent.
   */
  private gatewayUpdateHandler(): EventHandler {
    return {
      eventType: 'refund.gateway_update',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const p = event.payload as { gatewayRefundId?: string; status?: 'processed' | 'failed' };
        if (!p.gatewayRefundId || (p.status !== 'processed' && p.status !== 'failed')) return;
        await this.refunds.reconcileGatewayEvent({ gatewayRefundId: p.gatewayRefundId, status: p.status });
      },
    };
  }

  private handler(): EventHandler {
    return {
      eventType: 'booking.cancelled',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const payload = event.payload as {
          cancellationId?: string; refundMinor?: number; refundDestination?: 'source' | 'alternate_account';
          altAccountDetails?: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string } | null;
        };
        const amountMinor = Number(payload.refundMinor ?? 0);
        if (amountMinor <= 0) return; // non-refundable cancellation — nothing to do
        await this.refunds.initiate({
          bookingId: event.aggregateId as BookingId, amountMinor, cancellationId: payload.cancellationId,
          destination: payload.refundDestination ?? 'source',
          altAccountDetails: payload.altAccountDetails ?? undefined,
        });
      },
    };
  }

  /**
   * Partial (some-seats) cancellations publish their OWN event —
   * see BookingService.cancelSeats — since the refund amount there is
   * this specific seat-subset's own proportional share, never the
   * booking's full paidMinor the way a normal cancellation's payload is.
   * The underlying refund-clawback math is unaffected either way: it
   * derives its proportion from the ORIGINAL ledger_entries/postings
   * (immutable), never from bookings.total_minor (which cancelSeats DOES
   * reduce) — see refund-clawback.ts's own totalCaptured computation.
   */
  private partialHandler(): EventHandler {
    return {
      eventType: 'booking.seats_cancelled',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const payload = event.payload as {
          cancellationId?: string; refundMinor?: number; refundDestination?: 'source' | 'alternate_account';
          altAccountDetails?: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string } | null;
        };
        const amountMinor = Number(payload.refundMinor ?? 0);
        if (amountMinor <= 0) return;
        await this.refunds.initiate({
          bookingId: event.aggregateId as BookingId, amountMinor, cancellationId: payload.cancellationId,
          destination: payload.refundDestination ?? 'source',
          altAccountDetails: payload.altAccountDetails ?? undefined,
        });
      },
    };
  }
}
