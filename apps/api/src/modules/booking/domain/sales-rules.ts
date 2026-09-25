/**
 * ============================================================================
 *  Per-service sales rules — pure
 * ============================================================================
 *
 * Checked on every hold, on every channel, after the seats themselves are
 * locked:
 *  - OTA release (#42, #170): OTAs / GDS partners together may hold or sell at
 *    most `otaReleasePct` % of a trip's seats (the service's own value, else
 *    the platform default; 100 = no limit).
 *  - category quotas (#173, #174): a number (or %) of seats is kept for women
 *    / senior citizens until `releaseHours` before departure. Anyone may book
 *    while enough free seats remain for the part of the quota not yet used;
 *    a booking made only of that category may always use the kept seats.
 *  - accessible seats (#141, #294): a disability-friendly seat is for a
 *    passenger in the 'disabled' category until the operator's release time
 *    (null = never released to others).
 */
import {
  QUOTA_CATEGORIES,
  type CategoryQuota,
  type QuotaCategory,
  type ServiceSalesRules,
} from '../../scheduling';

export interface SalesPassenger {
  gender?: string | null;
  category?: string | null;
}

export function inQuotaCategory(p: SalesPassenger, c: QuotaCategory): boolean {
  return c === 'female' ? p.gender?.toLowerCase() === 'female' : p.category === 'senior';
}

export function quotaSeats(q: CategoryQuota, capacity: number): number {
  if (q.seats !== undefined) return Math.min(q.seats, capacity);
  return Math.floor((capacity * Math.min(100, Math.max(0, q.pct ?? 0))) / 100);
}

export interface SalesState {
  /** Bookable seats on the trip. */
  capacity: number;
  /** Free seats on the requested segment BEFORE this booking (its own seats included). */
  freeSeats: number;
  /** Seats OTAs / GDS partners already hold or sold on the trip. */
  otaSeats: number;
  /** Passengers of each quota category already on the trip. */
  categorySeats: Record<QuotaCategory, number>;
}

const LABEL: Record<QuotaCategory, string> = { female: 'women', senior: 'senior citizens' };

/** Why this booking breaks a sales rule, or null. */
export function salesRuleViolation(input: {
  rules: ServiceSalesRules;
  platformOtaReleasePct: number;
  state: SalesState;
  isOta: boolean;
  passengers: SalesPassenger[];
  hoursToDeparture: number;
}): string | null {
  const { rules, state, passengers } = input;
  const n = passengers.length;

  if (input.isOta) {
    const pct = rules.otaReleasePct ?? input.platformOtaReleasePct;
    const allowance = Math.floor((state.capacity * Math.min(100, Math.max(0, pct))) / 100);
    if (state.otaSeats + n > allowance)
      return allowance - state.otaSeats > 0
        ? `Only ${allowance - state.otaSeats} seat(s) of this trip are released to partners`
        : 'The seats released to partners for this trip are sold out';
  }

  let stillKept = 0;
  const blocking: QuotaCategory[] = [];
  for (const c of QUOTA_CATEGORIES) {
    const q = rules.categoryQuotas?.[c];
    if (!q || input.hoursToDeparture <= q.releaseHours) continue;
    const inRequest = passengers.filter((p) => inQuotaCategory(p, c)).length;
    const kept = Math.max(0, quotaSeats(q, state.capacity) - state.categorySeats[c] - inRequest);
    if (kept > 0 && inRequest < n) blocking.push(c);
    stillKept += kept;
  }
  if (blocking.length > 0 && state.freeSeats - n < stillKept)
    return `The remaining seats are kept for ${blocking.map((c) => LABEL[c]).join(' and ')} until closer to departure`;
  return null;
}

/** Accessible seats: which of the chosen seats the passenger may not take yet. */
export function accessibleSeatViolation(input: {
  seats: { seatNumber: string; accessible: boolean }[];
  categoryBySeat: Record<string, string | null | undefined>;
  hoursToDeparture: number;
  /** null = accessible seats are never released to others. */
  releaseHours: number | null;
}): string | null {
  const released = input.releaseHours !== null && input.hoursToDeparture <= input.releaseHours;
  if (released) return null;
  const seat = input.seats.find(
    (s) => s.accessible && input.categoryBySeat[s.seatNumber] !== 'disabled',
  );
  return seat ? `Seat ${seat.seatNumber} is kept for a passenger with a disability` : null;
}
