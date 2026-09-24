import { newId, type TenantId, type Uuid } from '@kernel';

/**
 * Test data builders (the "Object Mother" / builder pattern).
 *
 * Tests should read like specifications, not like data-entry. A builder lets a
 * test say only what it cares about — `aTenant().suspended().build()` — and
 * fills everything else with valid defaults. When a required column is added in
 * a later migration, the default goes in ONE place here instead of in every
 * test that constructs the row.
 */
export function aTenantId(): TenantId {
  return newId() as unknown as TenantId;
}

export interface Builder<T> {
  build(): T;
}

/** Generic fluent builder base. */
export class FluentBuilder<T extends Record<string, unknown>> implements Builder<T> {
  constructor(protected props: T) {}

  with<K extends keyof T>(key: K, value: T[K]): this {
    this.props = { ...this.props, [key]: value };
    return this;
  }

  build(): T {
    return { ...this.props };
  }
}

export function id(): Uuid {
  return newId();
}
