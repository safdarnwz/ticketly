import { describe, it, expect } from 'vitest';

import { aggregateRatings, bayesianRating } from '../domain/rating-aggregate';

describe('aggregateRatings', () => {
  it('happy: computes count, 2dp average and star distribution', () => {
    const r = aggregateRatings([5, 4, 4, 3, 5]);
    expect(r.count).toBe(5);
    expect(r.average).toBe(4.2);
    expect(r.distribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 2, 5: 2 });
  });

  it('edge: no ratings → average 0, empty distribution', () => {
    const r = aggregateRatings([]);
    expect(r.count).toBe(0);
    expect(r.average).toBe(0);
    expect(r.distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('negative: rejects out-of-range or non-integer ratings', () => {
    expect(() => aggregateRatings([5, 6])).toThrow();
    expect(() => aggregateRatings([0])).toThrow();
    expect(() => aggregateRatings([4.5])).toThrow();
  });
});

describe('bayesianRating', () => {
  it('happy: a few 5★ are pulled toward the prior', () => {
    // 3 reviews all 5★, prior 3.5 weight 10 → (35 + 15) / 13 = 3.85
    expect(bayesianRating(3, 5, 3.5, 10)).toBe(3.85);
  });

  it('positive: converges to the average as count grows', () => {
    const many = bayesianRating(900, 4.7, 3.5, 10);
    expect(many).toBeGreaterThan(4.68);
    expect(many).toBeLessThanOrEqual(4.7);
  });

  it('positive: high-volume 4.7 outranks low-volume 5.0 (the whole point)', () => {
    const bigOperator = bayesianRating(900, 4.7);
    const tinyOperator = bayesianRating(1, 5.0);
    expect(bigOperator).toBeGreaterThan(tinyOperator);
  });

  it('edge: zero reviews returns the prior mean', () => {
    expect(bayesianRating(0, 0, 3.5, 10)).toBe(3.5);
  });

  it('negative: negative count or weight throws', () => {
    expect(() => bayesianRating(-1, 4)).toThrow();
    expect(() => bayesianRating(5, 4, 3.5, -1)).toThrow();
  });
});
