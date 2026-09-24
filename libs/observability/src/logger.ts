import { Injectable, Scope, type LoggerService } from '@nestjs/common';
import pino, { type Logger as PinoLogger } from 'pino';

import { contextLogFields, toAppError, type UnknownRecord } from '@kernel';
import { AppConfig } from '@config';

/**
 * ============================================================================
 *  Structured logging
 * ============================================================================
 *
 * Rules that make logs actually usable at 3am:
 *
 *  1. **JSON only in production.** Line-oriented JSON is greppable, indexable
 *     and machine-parseable. `pino-pretty` is dev-only and is a separate
 *     process in production if ever needed (it costs ~40% of logging time).
 *
 *  2. **Every line carries the request context automatically** — requestId,
 *     correlationId, tenantId, traceId — pulled from AsyncLocalStorage rather
 *     than passed by hand. One `grep correlationId` reconstructs a whole
 *     distributed request.
 *
 *  3. **Redaction is declarative and central** (`LOG_REDACT_PATHS`). Never rely
 *     on developers remembering not to log a card number.
 *
 *  4. **Message first, object second, always the same shape.**
 *     `log.info({ bookingId }, 'booking confirmed')` — not string interpolation.
 *     Interpolated messages destroy aggregation.
 */

export const ROOT_LOGGER = Symbol('ROOT_LOGGER');

export function createRootLogger(config: AppConfig): PinoLogger {
  const { observability, app } = config;

  return pino({
    level: observability.logLevel,
    base: {
      service: app.name,
      version: app.version,
      instance: app.instanceId,
      env: config.env_,
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: observability.redactPaths,
      censor: '[REDACTED]',
    },
    formatters: {
      // Emit `level: "info"` rather than `level: 30`; log backends group on it.
      level: (label) => ({ level: label }),
    },
    // Inject ambient request context into every line without touching call sites.
    mixin: () => contextLogFields(),
    ...(observability.logPretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,version,instance,env' },
          },
        }
      : {}),
  });
}

/**
 * Injectable logger. Inject it, then call `.forContext('BookingService')` or
 * use the `@InjectLogger()` helper which does that automatically.
 */
@Injectable({ scope: Scope.DEFAULT })
export class Logger implements LoggerService {
  constructor(private readonly pinoLogger: PinoLogger) {}

  /** Child logger tagged with a component name. Cheap — reuse it as a field. */
  forContext(context: string, bindings: UnknownRecord = {}): Logger {
    return new Logger(this.pinoLogger.child({ context, ...bindings }));
  }

  /** Child logger with extra permanent bindings. */
  child(bindings: UnknownRecord): Logger {
    return new Logger(this.pinoLogger.child(bindings));
  }

  trace(obj: UnknownRecord | string, message?: string): void {
    this.emit('trace', obj, message);
  }
  debug(obj: UnknownRecord | string, message?: string): void {
    this.emit('debug', obj, message);
  }
  /** `log` is Nest's LoggerService alias for info. */
  log(obj: UnknownRecord | string, message?: string): void {
    this.emit('info', obj, message);
  }
  info(obj: UnknownRecord | string, message?: string): void {
    this.emit('info', obj, message);
  }
  warn(obj: UnknownRecord | string, message?: string): void {
    this.emit('warn', obj, message);
  }
  fatal(obj: UnknownRecord | string, message?: string): void {
    this.emit('fatal', obj, message);
  }

  /**
   * Errors take the error first so the stack, code and cause chain are always
   * serialised consistently.
   */
  error(errorOrObj: unknown, message?: string, extra: UnknownRecord = {}): void {
    if (errorOrObj instanceof Error) {
      const appError = toAppError(errorOrObj);
      this.pinoLogger.error({ err: appError.toLogJSON(), ...extra }, message ?? appError.message);
      return;
    }
    this.emit('error', errorOrObj as UnknownRecord, message);
  }

  /** Escape hatch for pino-specific APIs. */
  raw(): PinoLogger {
    return this.pinoLogger;
  }

  isLevelEnabled(level: string): boolean {
    return this.pinoLogger.isLevelEnabled(level);
  }

  private emit(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal', obj: UnknownRecord | string, message?: string): void {
    if (typeof obj === 'string') this.pinoLogger[level](obj);
    else this.pinoLogger[level](obj, message);
  }
}
