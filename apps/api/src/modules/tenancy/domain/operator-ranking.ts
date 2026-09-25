/** Platform ranking of operators over a period (#106). */
export interface OperatorPerformance {
  tenantId: string;
  bookings: number;
  revenueMinor: number;
  cancelled: number;
  seats: number;
}

export type RankingMeasure = 'revenue' | 'bookings' | 'seats' | 'cancellationRate';

export interface RankedOperator extends OperatorPerformance {
  rank: number;
  /** Cancelled ÷ (confirmed + cancelled), 0–1, 3 decimals. */
  cancellationRate: number;
}

const measure: Record<RankingMeasure, (p: RankedOperator) => number> = {
  revenue: (p) => p.revenueMinor,
  bookings: (p) => p.bookings,
  seats: (p) => p.seats,
  // Lower is better: rank by the negative.
  cancellationRate: (p) => -p.cancellationRate,
};

/** Best first; ties share a rank (1, 2, 2, 4). */
export function rankOperators(rows: OperatorPerformance[], by: RankingMeasure): RankedOperator[] {
  const withRate = rows.map((r) => {
    const total = r.bookings + r.cancelled;
    return {
      ...r,
      rank: 0,
      cancellationRate: total === 0 ? 0 : Math.round((r.cancelled / total) * 1000) / 1000,
    };
  });
  const key = measure[by];
  withRate.sort((a, b) => key(b) - key(a));
  withRate.forEach((r, i) => {
    r.rank = i > 0 && key(withRate[i - 1]) === key(r) ? withRate[i - 1].rank : i + 1;
  });
  return withRate;
}
