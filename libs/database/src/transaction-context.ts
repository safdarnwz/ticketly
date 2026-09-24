import { AsyncLocalStorage } from 'node:async_hooks';

import type { PoolClient } from 'pg';

import type { DomainEvent, TenantId } from '@kernel';

/**
 * Ambient transaction scope.
 *
 * Kept in its own file (importing nothing from the rest of the database lib) so
 * that `DatabaseService` can ask "am I inside a transaction?" without creating
 * an import cycle with `UnitOfWork`.
 *
 * Effect: any repository called anywhere beneath `uow.run(...)` automatically
 * joins that transaction. Services never pass a `tx` handle around, and it is
 * impossible to accidentally run half a booking outside the transaction.
 */
export interface TransactionScope {
  readonly client: PoolClient;
  readonly id: string;
  readonly startedAt: number;
  readonly tenantId: TenantId | null;
  readonly isolation: IsolationLevel;
  readonly readOnly: boolean;
  /** Depth of nesting; > 0 means we are inside a SAVEPOINT. */
  depth: number;
  /** Domain events collected during the transaction, flushed to the outbox. */
  readonly events: DomainEvent[];
  /** Callbacks that run only after a successful COMMIT. */
  readonly afterCommit: (() => void | Promise<void>)[];
  /** Callbacks that run after a ROLLBACK. */
  readonly afterRollback: (() => void | Promise<void>)[];
}

export type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

const storage = new AsyncLocalStorage<TransactionScope>();

export function currentTransaction(): TransactionScope | undefined {
  return storage.getStore();
}

export function runInTransactionScope<T>(scope: TransactionScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function inTransaction(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * Register work that must only happen if the transaction commits — sending a
 * webhook, invalidating a cache key, emitting a metric. Running these inline
 * would produce phantom side effects for transactions that later roll back.
 */
export function onCommit(callback: () => void | Promise<void>): void {
  const scope = storage.getStore();
  if (!scope) {
    // Outside a transaction the operation is already durable.
    void callback();
    return;
  }
  scope.afterCommit.push(callback);
}

export function onRollback(callback: () => void | Promise<void>): void {
  storage.getStore()?.afterRollback.push(callback);
}

/** Queue a domain event for the transactional outbox. */
export function recordEvent(event: DomainEvent): void {
  const scope = storage.getStore();
  if (!scope) {
    throw new Error(
      'recordEvent() requires an open transaction — domain events must be written atomically with the state change they describe',
    );
  }
  scope.events.push(event);
}
