/**
 * Per-service sales rules (#170, #173, #174) as stored on `services.sales_rules`.
 * Booking enforces them on every hold (booking/domain/sales-rules.ts).
 */
export const QUOTA_CATEGORIES = ['female', 'senior'] as const;
export type QuotaCategory = (typeof QUOTA_CATEGORIES)[number];

export interface CategoryQuota {
  /** Seats kept — or `pct` of the trip's seats. Exactly one of the two. */
  seats?: number;
  pct?: number;
  /** Released to everyone this many hours before departure. */
  releaseHours: number;
}

export interface ServiceSalesRules {
  /** Share of each trip OTAs / GDS partners may sell; absent = platform default. */
  otaReleasePct?: number | null;
  categoryQuotas?: Partial<Record<QuotaCategory, CategoryQuota>>;
}

export function salesRulesErrors(
  rules: ServiceSalesRules,
  seatCapacity: number | null = null,
): string[] {
  const errors: string[] = [];
  for (const [c, q] of Object.entries(rules.categoryQuotas ?? {})) {
    if (!q) continue;
    if ((q.seats === undefined) === (q.pct === undefined)) {
      errors.push(`${c}: give either seats or pct`);
      continue;
    }
    // A ladies-special bus keeps every seat (pct 100); a seat count beyond the bus is a typo.
    if (seatCapacity && q.seats !== undefined && q.seats > seatCapacity)
      errors.push(`${c}: the bus has only ${seatCapacity} seats`);
  }
  return errors;
}
