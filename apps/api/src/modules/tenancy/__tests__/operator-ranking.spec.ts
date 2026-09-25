import { describe, expect, it } from 'vitest';

import { rankOperators } from '../domain/operator-ranking';

const rows = [
  { tenantId: 'a', bookings: 10, revenueMinor: 5_000, cancelled: 0, seats: 12 },
  { tenantId: 'b', bookings: 30, revenueMinor: 9_000, cancelled: 10, seats: 40 },
  { tenantId: 'c', bookings: 30, revenueMinor: 1_000, cancelled: 3, seats: 30 },
];

describe('rankOperators', () => {
  it('ranks by revenue, best first', () => {
    expect(rankOperators(rows, 'revenue').map((r) => [r.tenantId, r.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
  });

  it('ties share a rank', () => {
    expect(rankOperators(rows, 'bookings').map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('lowest cancellation rate ranks first', () => {
    const ranked = rankOperators(rows, 'cancellationRate');
    expect(ranked.map((r) => r.tenantId)).toEqual(['a', 'c', 'b']);
    expect(ranked[2].cancellationRate).toBe(0.25);
  });
});
