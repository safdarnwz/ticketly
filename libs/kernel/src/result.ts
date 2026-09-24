import type { AppError } from './errors';
import { toAppError } from './errors';

/**
 * ============================================================================
 *  Result<T, E> — explicit, type-checked failure handling
 * ============================================================================
 *
 * WHEN TO USE WHICH:
 *
 *  - **throw AppError**  → for failures the caller almost never handles
 *    locally: "not found", "forbidden", "validation failed". The global filter
 *    turns them into HTTP responses. This keeps happy-path code clean.
 *
 *  - **return Result**   → for *expected* branches the caller MUST handle:
 *    seat-hold contention, gateway decline, fare-rule miss. Making these a
 *    return value means the compiler refuses to let you forget the sad path,
 *    which is exactly what you want in the booking saga.
 *
 * Do not mix the two for the same condition. Pick one per operation and be
 * consistent within a bounded context.
 */

export type Result<T, E = AppError> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly ok = true as const;
  constructor(readonly value: T) {}

  isOk(): this is Ok<T, E> {
    return true;
  }
  isErr(): this is Err<T, E> {
    return false;
  }
  unwrap(): T {
    return this.value;
  }
  unwrapOr(_fallback: T): T {
    return this.value;
  }
  unwrapErr(): E {
    throw new Error('Called unwrapErr() on an Ok result');
  }
  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }
  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return this as unknown as Result<T, F>;
  }
  andThen<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }
  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.ok(this.value);
  }
  tap(fn: (value: T) => void): Result<T, E> {
    fn(this.value);
    return this;
  }
}

export class Err<T, E> {
  readonly ok = false as const;
  constructor(readonly error: E) {}

  isOk(): this is Ok<T, E> {
    return false;
  }
  isErr(): this is Err<T, E> {
    return true;
  }
  unwrap(): T {
    if (this.error instanceof Error) throw this.error;
    throw new Error(`Called unwrap() on an Err result: ${JSON.stringify(this.error)}`);
  }
  unwrapOr(fallback: T): T {
    return fallback;
  }
  unwrapErr(): E {
    return this.error;
  }
  map<U>(_fn: (value: T) => U): Result<U, E> {
    return this as unknown as Result<U, E>;
  }
  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }
  andThen<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return this as unknown as Result<U, E>;
  }
  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    return handlers.err(this.error);
  }
  tap(_fn: (value: T) => void): Result<T, E> {
    return this;
  }
}

export function ok(): Result<void, never>;
export function ok<T>(value: T): Result<T, never>;
export function ok<T>(value?: T): Result<T | void, never> {
  return new Ok(value as T);
}

export function err<E>(error: E): Result<never, E> {
  return new Err(error) as unknown as Result<never, E>;
}

/** Collect an array of Results into a Result of array; first error wins. */
export function combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (r.isErr()) return r as unknown as Result<T[], E>;
    values.push(r.value);
  }
  return ok(values);
}

/** Run a throwing function and capture the throw as an `Err<AppError>`. */
export function attempt<T>(fn: () => T): Result<T, AppError> {
  try {
    return ok(fn());
  } catch (error) {
    return err(toAppError(error));
  }
}

/** Async variant of `attempt`. */
export async function attemptAsync<T>(fn: () => Promise<T>): Promise<Result<T, AppError>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err(toAppError(error));
  }
}

/** Convert a Result back into throw-style control flow. */
export function unwrapOrThrow<T, E>(result: Result<T, E>): T {
  if (result.isOk()) return result.value;
  throw result.error instanceof Error ? result.error : toAppError(result.error);
}
