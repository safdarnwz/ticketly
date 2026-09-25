import { describe, expect, it, vi } from 'vitest';

import { FixedClock, SystemClock } from '../clock';
import { BadRequestError, InternalError, ServiceUnavailableError, TimeoutError } from '../errors';
import {
  assertPresent,
  chunk,
  compact,
  groupBy,
  indexBy,
  invariant,
  isNonEmptyArray,
  present,
  require_,
  unique,
} from '../guard';
import { retry, sleep, withTimeout } from '../retry';
import { SingleFlight } from '../single-flight';

describe('retry', () => {
  it('returns the first success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ServiceUnavailableError('down'))
      .mockResolvedValue(7);
    await expect(retry(fn, { baseDelayMs: 1 })).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new BadRequestError('no'));
    await expect(retry(fn, { baseDelayMs: 1 })).rejects.toBeInstanceOf(BadRequestError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempts and normalises the error', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      retry(fn, { attempts: 3, baseDelayMs: 1, shouldRetry: () => true, onRetry }),
    ).rejects.toBeInstanceOf(InternalError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(retry(async () => 1, { signal: controller.signal })).rejects.toThrow('cancelled');
  });
});

describe('sleep / withTimeout', () => {
  it('sleeps, and rejects when aborted before or during the wait', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
    const pre = new AbortController();
    pre.abort('stop');
    await expect(sleep(10, pre.signal)).rejects.toThrow('stop');
    const during = new AbortController();
    const p = sleep(1_000, during.signal);
    during.abort();
    await expect(p).rejects.toThrow(/aborted/i);
  });

  it('resolves in time, times out otherwise', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'fast')).resolves.toBe('ok');
    await expect(withTimeout(new Promise(() => undefined), 5, 'slow')).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });
});

describe('SingleFlight', () => {
  it('shares one in-flight load per key and forgets it afterwards', async () => {
    const flight = new SingleFlight<number>();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await sleep(5);
      return 42;
    };
    const [a, b] = await Promise.all([flight.do('k', loader), flight.do('k', loader)]);
    expect([a, b, calls]).toEqual([42, 42, 1]);
    expect(flight.size).toBe(0);
    const pending = flight.do('x', loader);
    expect(flight.size).toBe(1);
    flight.forget('x');
    expect(flight.size).toBe(0);
    await pending;
  });
});

describe('guards and collection helpers', () => {
  it('asserts', () => {
    expect(() => invariant(false, 'x')).toThrow(InternalError);
    expect(() => require_(false, 'bad input')).toThrow(BadRequestError);
    expect(() => assertPresent(null, 'thing')).toThrow("Expected 'thing' to be present");
    expect(present(0, 'zero')).toBe(0);
    invariant(true, 'fine');
  });

  it('shapes collections', () => {
    expect(isNonEmptyArray([])).toBe(false);
    expect(isNonEmptyArray([1])).toBe(true);
    expect(compact([1, null, 2, undefined])).toEqual([1, 2]);
    expect(unique([1, 1, 2])).toEqual([1, 2]);
    expect([...groupBy(['a1', 'b1', 'a2'], (s) => s[0]).entries()]).toEqual([
      ['a', ['a1', 'a2']],
      ['b', ['b1']],
    ]);
    expect(indexBy([{ id: 1 }, { id: 2 }], (o) => o.id).get(2)).toEqual({ id: 2 });
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => chunk([1], 0)).toThrow(BadRequestError);
  });
});

describe('clocks', () => {
  it('a fixed clock only moves when told to', () => {
    const clock = new FixedClock('2026-01-01T00:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
    expect(clock.monotonic()).toBe(1_000);
    clock.set(new Date('2027-01-01T00:00:00Z'));
    expect(clock.now().getUTCFullYear()).toBe(2027);
  });

  it('the system clock is real time', () => {
    const clock = new SystemClock();
    expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(1_000);
    expect(clock.monotonic()).toBeGreaterThan(0);
  });
});
