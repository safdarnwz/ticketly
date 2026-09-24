import { describe, expect, it } from 'vitest';

import { attempt, combine, err, ok } from '../result';

describe('Result', () => {
  it('maps and chains on Ok', () => {
    const r = ok(2)
      .map((n) => n * 3)
      .andThen((n) => ok(n + 1));
    expect(r.unwrap()).toBe(7);
  });

  it('short-circuits on Err', () => {
    const r = err<string>('boom').map((n: number) => n * 2);
    expect(r.isErr()).toBe(true);
    expect(r.unwrapOr(0)).toBe(0);
  });

  it('combine returns the first error', () => {
    expect(combine([ok(1), err('bad'), ok(3)]).isErr()).toBe(true);
  });

  it('attempt captures throws', () => {
    const r = attempt(() => {
      throw new Error('nope');
    });
    expect(r.isErr()).toBe(true);
  });
});
