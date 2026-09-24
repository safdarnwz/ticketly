import { describe, expect, it } from 'vitest';

import { earlyCancelCredit } from '../domain/promotion-pricing';

const ist = (d: string) => new Date(`${d}T00:00:00+05:30`);

describe('earlyCancelCredit', () => {
  const tenDays = { priceMinor: 40_000, startsAt: ist('2030-03-01'), endsAt: ist('2030-03-11') };

  it('credits the whole price when cancelled before the promotion starts', () => {
    expect(earlyCancelCredit({ ...tenDays, nextMidnight: ist('2026-09-25') })).toEqual({
      unusedDays: 10,
      creditMinor: 40_000,
    });
  });

  it('charges the day of cancellation in full', () => {
    // Cancelled on day 3 (Mar 3): Mar 1–3 charged, Mar 4–10 credited.
    expect(earlyCancelCredit({ ...tenDays, nextMidnight: ist('2030-03-04') })).toEqual({
      unusedDays: 7,
      creditMinor: 28_000,
    });
  });

  it('credits nothing on the last day or after the end', () => {
    expect(earlyCancelCredit({ ...tenDays, nextMidnight: ist('2030-03-11') }).creditMinor).toBe(0);
    expect(earlyCancelCredit({ ...tenDays, nextMidnight: ist('2030-04-01') }).creditMinor).toBe(0);
  });

  it('rounds the credit down, never above the unused fraction', () => {
    const r = earlyCancelCredit({
      priceMinor: 10_001,
      startsAt: ist('2030-03-01'),
      endsAt: ist('2030-03-04'),
      nextMidnight: ist('2030-03-02'),
    });
    expect(r).toEqual({ unusedDays: 2, creditMinor: 6_667 });
  });

  it('never credits more than the price', () => {
    const far = earlyCancelCredit({ ...tenDays, nextMidnight: new Date(0) });
    expect(far.creditMinor).toBe(40_000);
  });
});
