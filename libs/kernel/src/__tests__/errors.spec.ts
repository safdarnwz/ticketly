import { describe, expect, it } from 'vitest';

import { ErrorCode } from '../error-codes';
import {
  AppError,
  BadRequestError,
  ConflictError,
  DependencyError,
  DomainError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  OptimisticLockError,
  PreconditionFailedError,
  RateLimitedError,
  ServiceUnavailableError,
  TimeoutError,
  UnauthenticatedError,
  ValidationError,
  isRetryable,
  toAppError,
} from '../errors';

describe('error kernel', () => {
  it('maps every error to its HTTP status and retryability', () => {
    const cases: [AppError, number, boolean][] = [
      [new ValidationError([{ path: 'a', rule: 'too_small', message: 'x' }]), 400, false],
      [new BadRequestError('bad'), 400, false],
      [new UnauthenticatedError(), 401, false],
      [new ForbiddenError(), 403, false],
      [new NotFoundError('Trip', 't1'), 404, false],
      [new ConflictError('taken'), 409, false],
      [new OptimisticLockError('Booking', 'b1'), 409, true],
      [new PreconditionFailedError('stale'), 412, false],
      [new DomainError(ErrorCode.COMMON_VALIDATION, 'rule'), 422, false],
      [new RateLimitedError(30), 429, true],
      [new InternalError(), 500, true],
      [new DependencyError('razorpay'), 502, true],
      [new ServiceUnavailableError('maintenance'), 503, true],
      [new TimeoutError('query', 100), 504, true],
    ];
    for (const [error, status, retryable] of cases) {
      expect([error.name, error.status, error.retryable]).toEqual([error.name, status, retryable]);
      expect(isRetryable(error)).toBe(retryable);
    }
  });

  it('projects a client-safe view and a full log view', () => {
    const cause = new Error('socket hang up');
    const e = new NotFoundError('Trip', 't1', { meta: { secret: 'internal' }, cause });
    expect(e.toPublicJSON()).toEqual({
      code: ErrorCode.COMMON_NOT_FOUND,
      message: "Trip 't1' was not found",
      details: { resource: 'Trip', id: 't1' },
      retryable: false,
    });
    expect(JSON.stringify(e.toPublicJSON())).not.toContain('internal');
    const log = e.toLogJSON();
    expect(log.meta).toEqual({ secret: 'internal' });
    expect(log.cause).toMatchObject({ name: 'Error', message: 'socket hang up' });
    expect(
      new InternalError('x', { cause: new ConflictError('c') }).toLogJSON().cause,
    ).toMatchObject({
      code: ErrorCode.COMMON_CONFLICT,
    });
    expect(new InternalError('x', { cause: 'text' }).toLogJSON().cause).toBe('text');
    expect(new NotFoundError('Stop').message).toBe('Stop was not found');
  });

  it('recognises codes and normalises anything thrown', () => {
    expect(AppError.hasCode(new ForbiddenError(), ErrorCode.COMMON_FORBIDDEN)).toBe(true);
    expect(AppError.hasCode(new Error('x'), ErrorCode.COMMON_FORBIDDEN)).toBe(false);
    const known = new ConflictError('c');
    expect(toAppError(known)).toBe(known);
    expect(toAppError(new Error('plain'))).toMatchObject({ status: 500, message: 'plain' });
    expect(toAppError('a string')).toMatchObject({ message: 'Non-Error value thrown' });
    expect(isRetryable(new Error('plain'))).toBe(false);
    expect(new AppError(ErrorCode.COMMON_FORBIDDEN, 403).message).toBe('Permission denied');
  });
});
