import { newId, type TenantId, type Uuid } from '../ids';
import type { Json } from '../types';

/**
 * A fact that has already happened, named in the past tense
 * (`booking.confirmed`, `trip.cancelled`).
 *
 * Events are the seam that keeps modules decoupled. The booking module does not
 * call the notification module; it records `booking.confirmed` and moves on.
 * Delivery is via the **transactional outbox** (libs/messaging): the event row
 * is written in the SAME transaction as the state change, so it is impossible
 * to confirm a booking without also enqueueing its notifications, or to send a
 * confirmation for a booking that rolled back.
 *
 * NAMING CONTRACT: `<aggregate>.<past-tense-verb>` — stable forever, it is a
 * public integration contract for OTA partners (Part 10).
 */
export interface DomainEvent<TPayload extends Json = Json> {
  readonly eventId: Uuid;
  readonly type: string;
  /** Schema version for the payload; bump on breaking changes. */
  readonly version: number;
  readonly occurredAt: Date;
  readonly tenantId?: TenantId;
  /** Aggregate that emitted the event. */
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** Correlation id of the request that caused it — end-to-end traceability. */
  readonly correlationId?: string;
  /** Id of the event that caused this one, for causal chains. */
  readonly causationId?: string;
  readonly payload: TPayload;
}

export function createEvent<TPayload extends Json>(input: {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  version?: number;
  tenantId?: TenantId;
  correlationId?: string;
  causationId?: string;
  occurredAt?: Date;
}): DomainEvent<TPayload> {
  return {
    eventId: newId(),
    type: input.type,
    version: input.version ?? 1,
    occurredAt: input.occurredAt ?? new Date(),
    tenantId: input.tenantId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    correlationId: input.correlationId,
    causationId: input.causationId,
    payload: input.payload,
  };
}

/** Handler contract. Implementations must be idempotent — see Part 9. */
export interface EventHandler<E extends DomainEvent = DomainEvent> {
  readonly eventType: string;
  handle(event: E): Promise<void>;
}
