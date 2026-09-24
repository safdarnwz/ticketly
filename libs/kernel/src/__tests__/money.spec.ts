import { describe, expect, it } from 'vitest';

import { Money } from '../money';

describe('Money', () => {
  it('stores minor units and never uses floats', () => {
    expect(Money.fromMajor('1249.50').minor).toBe(124950);
    expect(Money.fromMajor(0.1).plus(Money.fromMajor(0.2)).toMajor()).toBe(0.3);
  });

  it('allocate loses no paisa', () => {
    const parts = Money.of(10000).allocate(3);
    expect(parts.map((p) => p.minor)).toEqual([3334, 3333, 3333]);
    expect(Money.sum(parts).minor).toBe(10000);
  });

  it('allocate by weights preserves the total', () => {
    const parts = Money.of(9999).allocate([1, 1, 1, 1]);
    expect(Money.sum(parts).minor).toBe(9999);
  });

  it('computes GST as a percentage', () => {
    expect(Money.of(100000).percent(18).minor).toBe(18000);
  });

  it('rejects cross-currency arithmetic', () => {
    expect(() => Money.of(100, 'INR').plus(Money.of(100, 'USD'))).toThrow(/Currency mismatch/);
  });

  it('clamps negative amounts to zero for refunds', () => {
    expect(Money.of(-500).clampZero().minor).toBe(0);
  });
});
