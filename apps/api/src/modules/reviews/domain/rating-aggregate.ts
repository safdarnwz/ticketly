import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Rating aggregation
 * ============================================================================
 *
 * Turns a set of 1–5 star reviews into the numbers a storefront shows and ranks
 * by. Two figures matter and they are different:
 *
 *   - `average`  — the plain mean, what users see ("4.3 ★ from 128 reviews").
 *   - `bayesian` — the mean pulled toward a global prior in proportion to how
 *     FEW reviews there are. This is what you SORT by, so a single 5★ operator
 *     doesn't outrank a 4.7★ operator with 900 reviews. As the count grows the
 *     Bayesian score converges to the plain average.
 *
 *        bayesian = (priorWeight·priorMean + Σ ratings) / (priorWeight + count)
 *
 * Pure and exact-ish (values rounded to 2 dp at the edges), so ranking is
 * deterministic and testable.
 */

export interface RatingAggregate {
  count: number;
  average: number;                    // 2 dp
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

function assertStar(r: number): void {
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    throw new DomainError(ErrorCode.REVIEW_INVALID_RATING, `Rating must be an integer 1–5, got ${r}`);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function aggregateRatings(ratings: number[]): RatingAggregate {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of ratings) {
    assertStar(r);
    distribution[r as 1 | 2 | 3 | 4 | 5] += 1;
    sum += r;
  }
  const count = ratings.length;
  return { count, average: count ? round2(sum / count) : 0, distribution };
}

/**
 * Bayesian ("true") rating for ranking. `priorMean` is the global average star
 * (default 3.5); `priorWeight` is how many prior votes to blend in (default 10).
 */
export function bayesianRating(
  count: number,
  average: number,
  priorMean = 3.5,
  priorWeight = 10,
): number {
  if (count < 0 || priorWeight < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'count and priorWeight must be non-negative');
  }
  if (count === 0 && priorWeight === 0) return 0;
  const score = (priorWeight * priorMean + average * count) / (priorWeight + count);
  return Math.round(score * 100) / 100;
}
