import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type BookingId, type DomainEvent } from '@kernel';
import { Logger } from '@observability';

import { RefundService } from '@api/modules/refunds/application/services/refund.service';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

/**
 * Handles the REFUND side of a reschedule (fare went DOWN — customer is
 * owed the difference back). Mirrors RefundConsumer's pattern exactly,
 * reusing the SAME RefundService.initiate() — same idempotency guarantees,
 * same destination handling (source vs alternate-account) for every
 * booking regardless of how it was originally paid for.
 *
 * The AMOUNT-DUE side (fare went UP) is deliberately NOT handled here —
 * collecting additional money requires the customer to actively complete a
 * payment (a card/UPI/wallet charge), which a background event consumer has
 * no way to do on their behalf. That side needs a synchronous "pay the
 * difference" step in the reschedule flow itself (the same shape as
 * seat-upgrade's captureIncrementalPayment), not an automatic consumer —
 * left as an explicit gap rather than a wrong auto-charge.
 */
@Injectable()
export class AmendmentConsumer implements OnModuleInit {
  private readonly log: Logger;

  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly refunds: RefundService,
    logger: Logger,
  ) {
    this.log = logger.forContext('AmendmentConsumer');
  }

  onModuleInit(): void {
    this.dispatcher.register(this.handler());
  }

  private handler(): EventHandler {
    return {
      eventType: 'booking.rescheduled',
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return;
        const payload = event.payload as { refund?: number };
        const refundMinor = Number(payload.refund ?? 0);
        if (refundMinor <= 0) return; // fare went up or stayed the same — nothing to refund
        await this.refunds.initiate({
          bookingId: event.aggregateId as BookingId,
          amountMinor: refundMinor,
          destination: 'source',
        });
        this.log.info({ bookingId: event.aggregateId, refundMinor }, 'reschedule refund initiated');
      },
    };
  }
}
