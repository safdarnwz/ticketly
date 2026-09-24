/**
 * Kernel type utilities.
 *
 * These are deliberately dependency-free so the kernel can be imported from
 * anywhere (domain, infrastructure, tests) without dragging in Nest/pg/etc.
 */

declare const __brand: unique symbol;

/**
 * Nominal typing helper. `Brand<string, 'TenantId'>` is assignable to `string`
 * but a plain `string` is NOT assignable to it — which stops the single most
 * common class of bug in a system with 40+ id columns: passing a `tripId`
 * where a `vehicleId` was expected.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;

export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends (...args: never[]) => unknown
    ? T
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/** Make selected keys optional. */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Make selected keys required. */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/** Object with unknown values — safer than `any` for logging/metadata bags. */
export type UnknownRecord = Record<string, unknown>;

/** JSON-serialisable value. Used for outbox payloads, audit diffs, metadata. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Anything that can be awaited. */
export type Awaitable<T> = T | Promise<T>;

/** Constructor type, used by the DI helpers and test factories. */
export type Ctor<T = unknown> = new (...args: never[]) => T;

/** Exhaustiveness helper for switch statements over discriminated unions. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
