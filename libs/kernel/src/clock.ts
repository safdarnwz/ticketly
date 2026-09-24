/**
 * Injectable clock.
 *
 * Nothing in the domain calls `new Date()` or `Date.now()` directly. Every
 * time-dependent rule — hold expiry, cancellation windows, advance-purchase
 * pricing, trip cut-off — takes a `Clock`. That makes those rules testable
 * without sleeping and without monkey-patching globals, and it makes
 * time-travel integration tests ("what does the refund look like 2 hours
 * before departure?") a one-liner.
 */
export interface Clock {
  now(): Date;
  /** Monotonic milliseconds — safe for measuring durations. */
  monotonic(): number;
}

export const CLOCK = Symbol('CLOCK');

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  monotonic(): number {
    return performance.now();
  }
}

/** Deterministic clock for tests. */
export class FixedClock implements Clock {
  private current: number;
  private mono = 0;

  constructor(at: Date | string | number = 0) {
    this.current = typeof at === 'object' ? at.getTime() : new Date(at).getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  monotonic(): number {
    return this.mono;
  }

  /** Advance both wall-clock and monotonic time. */
  advance(ms: number): this {
    this.current += ms;
    this.mono += ms;
    return this;
  }

  set(at: Date | string | number): this {
    this.current = typeof at === 'object' ? at.getTime() : new Date(at).getTime();
    return this;
  }
}
