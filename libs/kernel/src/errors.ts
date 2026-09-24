import { ErrorCode, type ErrorCodeValue } from './error-codes';
import type { Json, UnknownRecord } from './types';

/**
 * ============================================================================
 *  Error kernel
 * ============================================================================
 *
 * Design goals:
 *  - **One base class.** Every error the application throws deliberately is an
 *    `AppError`. Anything else that reaches the global filter is, by
 *    definition, a bug and is logged at `error` with a stack trace.
 *  - **Transport-agnostic.** Nothing here imports Nest or HTTP. The HTTP layer
 *    (libs/http) translates `AppError -> RFC 9457 problem+json`. A gRPC or
 *    queue consumer can translate the same errors differently.
 *  - **Retry-aware.** `retryable` tells callers (and the outbox worker) whether
 *    a retry could plausibly succeed. Serialization failures: yes. Validation
 *    failures: no.
 *  - **Safe by default.** `details` is the ONLY thing surfaced to clients.
 *    `meta` is log-only and may contain internal identifiers.
 */

export type ErrorSeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AppErrorOptions {
  /** Human-readable, non-localised summary. Never contains secrets. */
  message?: string;
  /** Client-safe structured payload (field errors, seat numbers, limits...). */
  details?: Json;
  /** Log-only context. Never serialised to the client. */
  meta?: UnknownRecord;
  /** Original error, preserved for the stack trace chain. */
  cause?: unknown;
  /** Whether a naive retry of the same request could succeed. */
  retryable?: boolean;
  /** Hint for the client / proxy, emitted as `Retry-After` when present. */
  retryAfterSeconds?: number;
  /** Overrides the default log level for this code. */
  severity?: ErrorSeverity;
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details?: Json;
  readonly meta?: UnknownRecord;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly severity: ErrorSeverity;
  readonly timestamp: string;

  constructor(code: ErrorCodeValue, status: number, options: AppErrorOptions = {}) {
    super(options.message ?? defaultMessageFor(code), { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.meta = options.meta;
    this.retryable = options.retryable ?? status >= 500;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.severity = options.severity ?? (status >= 500 ? 'error' : 'warn');
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace?.(this, new.target);
  }

  /** Client-safe projection. The HTTP filter adds `instance` + `traceId`. */
  toPublicJSON(): {
    code: ErrorCodeValue;
    message: string;
    details?: Json;
    retryable: boolean;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details !== undefined ? { details: this.details } : {}),
      retryable: this.retryable,
    };
  }

  /** Full projection for logs. */
  toLogJSON(): UnknownRecord {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
      details: this.details,
      meta: this.meta,
      retryable: this.retryable,
      severity: this.severity,
      stack: this.stack,
      cause: serialiseCause(this.cause),
    };
  }

  static is(error: unknown): error is AppError {
    return error instanceof AppError;
  }

  /** True when `error` is an AppError carrying one of the given codes. */
  static hasCode(error: unknown, ...codes: ErrorCodeValue[]): error is AppError {
    return AppError.is(error) && codes.includes(error.code);
  }
}

/* ── 400 ─────────────────────────────────────────────────────────────────── */

export interface FieldIssue {
  /** Dot/bracket path, e.g. `passengers[0].age`. */
  path: string;
  /** Stable machine code from the validator, e.g. `too_small`. */
  rule: string;
  message: string;
}

export class ValidationError extends AppError {
  constructor(issues: FieldIssue[], options: Omit<AppErrorOptions, 'details'> = {}) {
    super(ErrorCode.COMMON_VALIDATION, 400, {
      message: 'Request validation failed',
      severity: 'info',
      ...options,
      details: { issues: issues as unknown as Json },
    });
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_VALIDATION, 400, { severity: 'info', ...options, message });
  }
}

/* ── 401 / 403 ───────────────────────────────────────────────────────────── */

export class UnauthenticatedError extends AppError {
  constructor(
    code: ErrorCodeValue = ErrorCode.COMMON_UNAUTHENTICATED,
    options: AppErrorOptions = {},
  ) {
    super(code, 401, { message: 'Authentication required', severity: 'info', ...options });
  }
}

export class ForbiddenError extends AppError {
  constructor(options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_FORBIDDEN, 403, {
      message: 'You do not have permission to perform this action',
      severity: 'warn',
      ...options,
    });
  }
}

/* ── 404 ─────────────────────────────────────────────────────────────────── */

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_NOT_FOUND, 404, {
      message: id ? `${resource} '${id}' was not found` : `${resource} was not found`,
      severity: 'info',
      details: { resource, ...(id ? { id } : {}) },
      ...options,
    });
  }
}

/* ── 409 / 412 / 422 ─────────────────────────────────────────────────────── */

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_CONFLICT, 409, { severity: 'info', ...options, message });
  }
}

export class PreconditionFailedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_PRECONDITION_FAILED, 412, { severity: 'info', ...options, message });
  }
}

/**
 * A domain invariant was violated. This is the error type aggregates throw:
 * "seat 12A is already sold", "trip has departed", "refund exceeds paid amount".
 */
export class DomainError extends AppError {
  constructor(code: ErrorCodeValue, message: string, options: AppErrorOptions = {}) {
    super(code, 422, { severity: 'info', ...options, message });
  }
}

/** Optimistic concurrency (version column mismatch). Always retryable. */
export class OptimisticLockError extends AppError {
  constructor(resource: string, id: string, options: AppErrorOptions = {}) {
    super(ErrorCode.DB_OPTIMISTIC_LOCK, 409, {
      message: `${resource} '${id}' was modified concurrently; retry the operation`,
      retryable: true,
      severity: 'info',
      ...options,
    });
  }
}

/* ── 429 ─────────────────────────────────────────────────────────────────── */

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_RATE_LIMITED, 429, {
      message: 'Too many requests',
      retryable: true,
      retryAfterSeconds,
      severity: 'warn',
      ...options,
    });
  }
}

/* ── 5xx ─────────────────────────────────────────────────────────────────── */

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred', options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_INTERNAL, 500, { severity: 'error', ...options, message });
  }
}

/** An upstream we depend on (gateway, SMS provider, OTA) failed. */
export class DependencyError extends AppError {
  constructor(dependency: string, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_DEPENDENCY_FAILED, 502, {
      message: `Upstream dependency '${dependency}' failed`,
      retryable: true,
      severity: 'error',
      details: { dependency },
      ...options,
    });
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_TIMEOUT, 504, {
      message: `Operation '${operation}' timed out after ${timeoutMs}ms`,
      retryable: true,
      severity: 'error',
      details: { operation, timeoutMs },
      ...options,
    });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(reason: string, retryAfterSeconds = 5, options: AppErrorOptions = {}) {
    super(ErrorCode.COMMON_UNAVAILABLE, 503, {
      message: reason,
      retryable: true,
      retryAfterSeconds,
      severity: 'error',
      ...options,
    });
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

const DEFAULT_MESSAGES: Partial<Record<ErrorCodeValue, string>> = {
  [ErrorCode.COMMON_INTERNAL]: 'An unexpected error occurred',
  [ErrorCode.COMMON_NOT_FOUND]: 'Resource not found',
  [ErrorCode.COMMON_CONFLICT]: 'The request conflicts with the current state',
  [ErrorCode.COMMON_UNAUTHENTICATED]: 'Authentication required',
  [ErrorCode.COMMON_FORBIDDEN]: 'Permission denied',
  [ErrorCode.COMMON_RATE_LIMITED]: 'Too many requests',
};

function defaultMessageFor(code: ErrorCodeValue): string {
  return DEFAULT_MESSAGES[code] ?? code;
}

function serialiseCause(cause: unknown): unknown {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof AppError) return cause.toLogJSON();
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message, stack: cause.stack };
  }
  return cause;
}

/**
 * Normalise any thrown value into an `AppError`. Used by the global HTTP
 * filter, the outbox worker and every job runner so error handling is uniform.
 */
export function toAppError(error: unknown): AppError {
  if (AppError.is(error)) return error;
  if (error instanceof Error) {
    return new InternalError(error.message, { cause: error });
  }
  return new InternalError('Non-Error value thrown', { meta: { thrown: error } });
}

/** True when retrying the operation could plausibly succeed. */
export function isRetryable(error: unknown): boolean {
  return AppError.is(error) ? error.retryable : false;
}
