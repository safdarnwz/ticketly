import { Injectable } from '@nestjs/common';

import { recordEvent } from '@database';
import {
  createEvent,
  getContext,
  type DomainEvent,
  type Json,
  type TenantId,
} from '@kernel';
import { Logger } from '@observability';

/**
 * ============================================================================
 *  Event publishing
 * ============================================================================
 *
 * Modules never call each other's services. They publish facts.
 *
 *   BookingService  → `booking.confirmed`
 *   NotificationModule, LoyaltyModule, AnalyticsModule, PartnerWebhooks
 *     all subscribe independently.
 *
 * Adding "send a WhatsApp message on confirmation" therefore touches ONE file
 * in the notification module — the booking module does not change, is not
 * redeployed, and cannot be broken by it. That is what makes feature
 * development in this codebase stay cheap as it grows.
 *
 * DELIVERY: strictly via the transactional outbox. `publish()` only appends to
 * the current transaction's event list; the row is written in the same COMMIT
 * (see `UnitOfWork.flushOutbox`) and the worker (Part 9) delivers it at least
 * once. Handlers must therefore be idempotent.
 *
 * There is deliberately NO "publish immediately, outside a transaction" method.
 * That is the dual-write bug the pattern exists to prevent.
 */
@Injectable()
export class EventBus {
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger.forContext('EventBus');
  }

  /**
   * Append a domain event to the current transaction.
   * Throws if called outside one — by design.
   */
  publish<TPayload extends Json>(input: {
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: TPayload;
    version?: number;
    tenantId?: TenantId;
  }): DomainEvent<TPayload> {
    const ctx = getContext();
    const event = createEvent({
      ...input,
      tenantId: input.tenantId ?? ctx?.tenantId,
      correlationId: ctx?.correlationId,
    });
    recordEvent(event as DomainEvent);
    this.log.debug({ type: event.type, aggregateId: event.aggregateId }, 'event queued');
    return event;
  }

  publishAll(events: DomainEvent[]): void {
    for (const event of events) recordEvent(event);
  }
}
