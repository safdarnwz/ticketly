import { FixedClock } from '@kernel';

/**
 * Shared fixtures — deterministic values so assertions are stable.
 *
 * The frozen clock is the important one: every time-dependent test (hold
 * expiry, cancellation windows, advance-purchase pricing) uses it so results
 * never depend on when the suite happens to run.
 */
export const FIXED_NOW = new Date('2026-03-15T09:30:00.000Z');

export function frozenClock(at: Date = FIXED_NOW): FixedClock {
  return new FixedClock(at);
}

export const SAMPLE_TIMEZONE = 'Asia/Kolkata';
