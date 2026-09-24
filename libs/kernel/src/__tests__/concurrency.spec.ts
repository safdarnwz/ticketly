import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from '../concurrency';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and preserves order', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (x) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(x);
      inFlight--;
      return x * 10;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
  });
  it('edge: empty input, and a limit larger than the input', async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 50, async (x) => x + 1)).toEqual([2, 3]);
  });
  it('negative: invalid limit throws; a failing item rejects the call', async () => {
    await expect(mapWithConcurrency([1], 0, async (x) => x)).rejects.toThrow(/limit/);
    await expect(
      mapWithConcurrency([1, 2], 2, async (x) => {
        if (x === 2) throw new Error('boom');
        return x;
      }),
    ).rejects.toThrow(/boom/);
  });
});
