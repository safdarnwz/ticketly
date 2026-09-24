import { BadRequestError, InternalError } from './errors';
import type { Maybe } from './types';

/**
 * Assertion helpers. These express *programmer* expectations (invariants that
 * should be impossible to violate) and *input* expectations (which a caller
 * can plausibly violate) with different error types, so the HTTP layer maps
 * them to 500 vs 400 automatically.
 */

/** Invariant violation → 500. Use for "this cannot happen" states. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InternalError(`Invariant violated: ${message}`);
}

/** Precondition on caller-supplied data → 400. */
export function require_(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BadRequestError(message);
}

/** Narrow away null/undefined, throwing 500 if absent. */
export function assertPresent<T>(value: Maybe<T>, name: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new InternalError(`Expected '${name}' to be present`);
  }
}

/** Narrow away null/undefined and return the value (expression position). */
export function present<T>(value: Maybe<T>, name: string): T {
  assertPresent(value, name);
  return value;
}

export function isNonEmptyArray<T>(value: T[]): value is [T, ...T[]] {
  return value.length > 0;
}

/** Remove null/undefined from an array with correct typing. */
export function compact<T>(values: Maybe<T>[]): T[] {
  return values.filter((v): v is T => v !== null && v !== undefined);
}

/** Deduplicate preserving first-seen order. */
export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Group an array into a Map by a derived key. */
export function groupBy<T, K>(values: T[], keyOf: (value: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const bucket = out.get(key);
    if (bucket) bucket.push(value);
    else out.set(key, [value]);
  }
  return out;
}

/** Index an array by a unique derived key. Later entries win. */
export function indexBy<T, K>(values: T[], keyOf: (value: T) => K): Map<K, T> {
  const out = new Map<K, T>();
  for (const value of values) out.set(keyOf(value), value);
  return out;
}

/** Split an array into fixed-size chunks — used for bulk INSERT batching. */
export function chunk<T>(values: T[], size: number): T[][] {
  require_(size > 0, 'chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
