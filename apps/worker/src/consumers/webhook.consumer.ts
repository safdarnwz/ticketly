import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type DomainEvent } from '@kernel';

import { WEBHOOK_EVENTS, WebhookDeliveryService } from '@api/modules/webhooks';
import { EventDispatcher, type EventHandler } from '../dispatcher/event-dispatcher';

/**
 * Turns internal domain events into signed webhook POSTs — to the operator's
 * own endpoints and to the GDS partner that sold the booking (see the
 * webhooks module's catalogue: GET /webhooks/catalogue).
 */
@Injectable()
export class WebhookConsumer implements OnModuleInit {
  constructor(
    private readonly dispatcher: EventDispatcher,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  onModuleInit(): void {
    for (const type of WEBHOOK_EVENTS) {
      this.dispatcher.register(this.handlerFor(type));
    }
  }

  private handlerFor(eventType: string): EventHandler {
    return {
      eventType,
      handle: async (event: DomainEvent) => {
        if (!event.tenantId) return; // platform-level events (e.g. tenant provisioning) aren't webhook-facing
        await this.delivery.deliverEvent({
          tenantId: event.tenantId,
          eventType,
          eventId: event.eventId,
          occurredAt: new Date(event.occurredAt).toISOString(),
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: (event.payload ?? {}) as Record<string, unknown>,
        });
      },
    };
  }
}
