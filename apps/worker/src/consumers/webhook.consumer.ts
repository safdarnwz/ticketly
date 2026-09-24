import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type DomainEvent } from '@kernel';

import { WebhookDeliveryService } from '@api/modules/distribution/application/services/webhook-delivery.service';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

/**
 * Turns internal domain events into signed webhook POSTs to OTA/GDS partners
 * — the concrete payoff of DistributionController's `webhooks/catalogue`
 * promise. Every event a partner might reasonably need to react to WITHOUT
 * polling: bookings and payments on their own channel, plus operational
 * disruptions (delay/cancellation) that affect a trip regardless of which
 * channel sold it.
 */
@Injectable()
export class WebhookConsumer implements OnModuleInit {
  private static readonly EVENT_TYPES = [
    'booking.confirmed', 'booking.cancelled',
    'trip.delayed', 'trip.departed',
    'payment.captured', 'refund.settled',
  ];

  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  onModuleInit(): void {
    for (const type of WebhookConsumer.EVENT_TYPES) {
      this.dispatcher.register(this.handlerFor(type));
    }
  }

  private handlerFor(eventType: string): EventHandler {
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return; // platform-level events (e.g. tenant provisioning) aren't partner-facing
        await this.delivery.deliverToTenant(event.tenantId, eventType, event.eventId, {
          event: eventType,
          eventId: event.eventId,
          occurredAt: event.occurredAt,
          data: event.payload,
        });
      },
    };
  }
}
