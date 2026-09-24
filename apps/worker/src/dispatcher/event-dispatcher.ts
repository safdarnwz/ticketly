import { Injectable } from '@nestjs/common';

import { type DomainEvent } from '@kernel';
import { Logger } from '@observability';

/**
 * Routes a domain event to every handler subscribed to its type.
 *
 * Handlers register themselves by event type; a single event may fan out to
 * many (booking.confirmed → send SMS + send email + notify OTA + update
 * analytics). A handler failure fails the whole event so it is retried — which
 * is safe precisely because handlers are idempotent. If different handlers need
 * independent retry, they subscribe to the event and re-emit their own
 * per-channel events; the notification handler does exactly this.
 */
export interface EventHandler {
  readonly eventType: string;
  handle(event: DomainEvent): Promise<void>;
}

@Injectable()
export class EventDispatcher {
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger.forContext('EventDispatcher');
  }

  register(handler: EventHandler): void {
    const list = this.handlers.get(handler.eventType) ?? [];
    list.push(handler);
    this.handlers.set(handler.eventType, list);
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const handlers = [
      ...(this.handlers.get(event.type) ?? []),
      ...(this.handlers.get('*') ?? []), // wildcard handlers (analytics, audit)
    ];
    if (handlers.length === 0) {
      this.log.debug({ type: event.type }, 'no handler for event; acknowledged');
      return;
    }
    // Run handlers in sequence so a failure stops and retries the whole event.
    for (const handler of handlers) {
      await handler.handle(event);
    }
  }
}
