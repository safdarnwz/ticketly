import {
  AppError,
  ConflictError,
  ErrorCode,
  InternalError,
  ServiceUnavailableError,
  type AppErrorOptions,
} from '@kernel';

/**
 * Translate Postgres SQLSTATE codes into the platform error kernel.
 *
 * Why this matters: without it, a unique-constraint race surfaces as a 500 and
 * pages someone at midnight. With it, `bookings_pnr_key` becomes a clean 409
 * that the client retries, and a serialization failure becomes a *retryable*
 * error the unit of work handles automatically.
 *
 * SQLSTATE reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

export interface PostgresError extends Error {
  code?: string;
  detail?: string;
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
  severity?: string;
}

export const PG_CODE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  ADMIN_SHUTDOWN: '57P01',
  CRASH_SHUTDOWN: '57P02',
  CANNOT_CONNECT_NOW: '57P03',
  TOO_MANY_CONNECTIONS: '53300',
  OUT_OF_MEMORY: '53200',
  DISK_FULL: '53100',
  READ_ONLY_SQL_TRANSACTION: '25006',
  INSUFFICIENT_PRIVILEGE: '42501',
  UNDEFINED_TABLE: '42P01',
  UNDEFINED_COLUMN: '42703',
  INVALID_TEXT_REPRESENTATION: '22P02',
  NUMERIC_VALUE_OUT_OF_RANGE: '22003',
  STRING_DATA_RIGHT_TRUNCATION: '22001',
  /** Also raised by Postgres when a materialized view created WITH NO DATA is queried before its first REFRESH. */
  OBJECT_NOT_IN_PREREQUISITE_STATE: '55000',
} as const;

/** SQLSTATEs where an immediate retry of the whole transaction is correct. */
const RETRYABLE = new Set<string>([
  PG_CODE.SERIALIZATION_FAILURE,
  PG_CODE.DEADLOCK_DETECTED,
  PG_CODE.LOCK_NOT_AVAILABLE,
  PG_CODE.CANNOT_CONNECT_NOW,
  PG_CODE.ADMIN_SHUTDOWN,
  PG_CODE.CRASH_SHUTDOWN,
]);

export function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && typeof (error as PostgresError).code === 'string';
}

export function isRetryablePgError(error: unknown): boolean {
  return isPostgresError(error) && !!error.code && RETRYABLE.has(error.code);
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!isPostgresError(error) || error.code !== PG_CODE.UNIQUE_VIOLATION) return false;
  return constraint === undefined || error.constraint === constraint;
}

/**
 * Constraint-name → human message map. Populated by each module as it adds
 * constraints, so a 409 tells the client exactly what collided instead of
 * leaking `duplicate key value violates unique constraint "..."`.
 */
const constraintMessages = new Map<string, string>();

export function registerConstraintMessage(constraint: string, message: string): void {
  constraintMessages.set(constraint, message);
}

export function registerConstraintMessages(entries: Record<string, string>): void {
  for (const [constraint, message] of Object.entries(entries)) {
    constraintMessages.set(constraint, message);
  }
}

export function mapPostgresError(error: unknown, options: AppErrorOptions = {}): AppError {
  if (AppError.is(error)) return error;
  if (!isPostgresError(error)) return new InternalError('Database error', { cause: error, ...options });

  const base: AppErrorOptions = {
    cause: error,
    meta: {
      sqlstate: error.code,
      table: error.table,
      column: error.column,
      constraint: error.constraint,
      // `detail` can contain row values (PII) — log-only, never surfaced.
      detail: error.detail,
    },
    ...options,
  };

  switch (error.code) {
    case PG_CODE.UNIQUE_VIOLATION: {
      const friendly = error.constraint ? constraintMessages.get(error.constraint) : undefined;
      return new ConflictError(friendly ?? 'A record with these values already exists', {
        ...base,
        details: { constraint: error.constraint ?? null },
      });
    }

    case PG_CODE.FOREIGN_KEY_VIOLATION:
      return new AppError(ErrorCode.DB_FOREIGN_KEY_VIOLATION, 409, {
        message: 'Referenced record does not exist or is still in use',
        details: { constraint: error.constraint ?? null },
        severity: 'info',
        ...base,
      });

    case PG_CODE.NOT_NULL_VIOLATION:
      return new AppError(ErrorCode.COMMON_VALIDATION, 400, {
        message: `Required value missing for '${error.column ?? 'field'}'`,
        details: { column: error.column ?? null },
        severity: 'info',
        ...base,
      });

    case PG_CODE.CHECK_VIOLATION:
    case PG_CODE.EXCLUSION_VIOLATION:
      return new AppError(ErrorCode.DB_CHECK_VIOLATION, 422, {
        message: constraintMessages.get(error.constraint ?? '') ?? 'A data integrity rule was violated',
        details: { constraint: error.constraint ?? null },
        severity: 'info',
        ...base,
      });

    case PG_CODE.SERIALIZATION_FAILURE:
      return new AppError(ErrorCode.DB_SERIALIZATION_FAILURE, 409, {
        message: 'Concurrent modification detected; please retry',
        retryable: true,
        severity: 'info',
        ...base,
      });

    case PG_CODE.DEADLOCK_DETECTED:
      return new AppError(ErrorCode.DB_DEADLOCK, 409, {
        message: 'Deadlock detected; please retry',
        retryable: true,
        severity: 'warn',
        ...base,
      });

    case PG_CODE.LOCK_NOT_AVAILABLE:
      return new AppError(ErrorCode.DB_LOCK_TIMEOUT, 409, {
        message: 'Resource is locked by another operation; please retry',
        retryable: true,
        severity: 'info',
        ...base,
      });

    case PG_CODE.QUERY_CANCELED:
      return new AppError(ErrorCode.DB_STATEMENT_TIMEOUT, 504, {
        message: 'Query exceeded its time budget and was cancelled',
        retryable: false,
        severity: 'error',
        ...base,
      });

    case PG_CODE.TOO_MANY_CONNECTIONS:
    case PG_CODE.OUT_OF_MEMORY:
    case PG_CODE.DISK_FULL:
      return new ServiceUnavailableError('Database is under pressure', 5, {
        severity: 'fatal',
        ...base,
      });

    case PG_CODE.READ_ONLY_SQL_TRANSACTION:
      // Almost always: a write was routed to a read replica. That is a bug in
      // the calling code, so make it loud rather than retrying it forever.
      return new InternalError('Write attempted on a read-only connection', {
        retryable: false,
        severity: 'fatal',
        ...base,
      });

    case PG_CODE.INVALID_TEXT_REPRESENTATION:
      return new AppError(ErrorCode.COMMON_VALIDATION, 400, {
        message: 'Malformed value for the column type',
        severity: 'info',
        ...base,
      });

    // Almost always: a materialized view (e.g. the reporting views) was
    // queried before its first REFRESH. Retryable because the scheduler (or
    // `npm run db:refresh-reports`) resolves it without any code change.
    case PG_CODE.OBJECT_NOT_IN_PREREQUISITE_STATE:
      return new AppError(ErrorCode.DB_VIEW_NOT_READY, 503, {
        message: "This report's data hasn't been generated yet — it refreshes automatically within a few minutes, or ask an administrator to refresh it now",
        retryable: true,
        retryAfterSeconds: 30,
        severity: 'warn',
        ...base,
      });

    default:
      return new InternalError('Database error', { severity: 'error', ...base });
  }
}
