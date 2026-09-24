import type { Uuid } from '../ids';
import type { Json } from '../types';
import type { DomainEvent } from './domain-event';
import { Entity } from './entity';

/**
 * The consistency boundary. One aggregate = one transaction = one row lock.
 *
 * RULES ENFORCED BY CONVENTION (and by the repository layer):
 *  - Never load or mutate two aggregates in one transaction unless they are in
 *    the same bounded context and the invariant genuinely spans both.
 *  - Cross-aggregate coordination goes through domain events + sagas
 *    (Part 7's booking saga is the canonical example).
 *  - `version` implements optimistic concurrency: the UPDATE carries
 *    `WHERE version = $expected` and a zero row count raises
 *    `OptimisticLockError`, which the caller retries.
 */
export abstract class AggregateRoot<TId extends Uuid = Uuid> extends Entity<TId> {
  private readonly pendingEvents: DomainEvent[] = [];

  /** Optimistic-concurrency token. Incremented by the repository on save. */
  protected _version = 0;

  get version(): number {
    return this._version;
  }

  /** Record an event to be published when the aggregate is persisted. */
  protected record<TPayload extends Json>(event: DomainEvent<TPayload>): void {
    this.pendingEvents.push(event as DomainEvent);
  }

  /** Drain events — called by the repository inside the write transaction. */
  pullEvents(): DomainEvent[] {
    return this.pendingEvents.splice(0, this.pendingEvents.length);
  }

  hasPendingEvents(): boolean {
    return this.pendingEvents.length > 0;
  }
}
