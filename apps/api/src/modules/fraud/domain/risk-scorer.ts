import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Booking risk scorer
 * ============================================================================
 *
 * A transparent, rule-weighted fraud score for a booking/payment attempt. Each
 * signal contributes a fixed number of points; the total (capped at 100) maps to
 * a band and a decision. "Transparent" is the design goal — every point is
 * attributable to a named reason, so a declined customer can be explained and a
 * false positive can be tuned, unlike an opaque model. Pure and deterministic:
 * the same signals always yield the same score, which is what makes it testable
 * and auditable.
 *
 *   score < 40   → low     → allow
 *   40 ≤ s < 70  → medium  → review   (manual / step-up auth)
 *   score ≥ 70   → high    → deny
 */

export interface RiskSignals {
  accountAgeDays: number;      // 0 for a brand-new account
  bookingsLast24h: number;     // velocity
  amountMinor: number;
  seatCount: number;
  emailDisposable: boolean;    // throwaway email domain
  paymentMethodNew: boolean;   // card/UPI first seen on this account
  billingCountryMismatch: boolean; // billing vs IP/issuer country differ
  nightBooking: boolean;       // placed 00:00–05:00 local
}

export type RiskBand = 'low' | 'medium' | 'high';
export type RiskDecision = 'allow' | 'review' | 'deny';

export interface RiskResult {
  score: number;      // 0–100
  band: RiskBand;
  decision: RiskDecision;
  reasons: { code: string; points: number }[];
}

const HIGH_VALUE_MINOR = 500_000; // ₹5,000
const VERY_HIGH_VALUE_MINOR = 1_500_000; // ₹15,000

export function scoreRisk(signals: RiskSignals): RiskResult {
  if (signals.accountAgeDays < 0 || signals.bookingsLast24h < 0 || signals.amountMinor < 0 || signals.seatCount < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Risk signals cannot be negative');
  }

  const reasons: { code: string; points: number }[] = [];
  const add = (code: string, points: number): void => { if (points > 0) reasons.push({ code, points }); };

  // New / very new account.
  if (signals.accountAgeDays === 0) add('brand_new_account', 20);
  else if (signals.accountAgeDays < 7) add('new_account', 10);

  // Velocity — many bookings in a day.
  if (signals.bookingsLast24h >= 10) add('very_high_velocity', 30);
  else if (signals.bookingsLast24h >= 5) add('high_velocity', 15);

  // Order value.
  if (signals.amountMinor >= VERY_HIGH_VALUE_MINOR) add('very_high_value', 20);
  else if (signals.amountMinor >= HIGH_VALUE_MINOR) add('high_value', 10);

  // Bulk seats on one order.
  if (signals.seatCount >= 8) add('bulk_seats', 15);

  if (signals.emailDisposable) add('disposable_email', 20);
  if (signals.paymentMethodNew) add('new_payment_method', 10);
  if (signals.billingCountryMismatch) add('billing_country_mismatch', 20);
  if (signals.nightBooking) add('night_booking', 5);

  const raw = reasons.reduce((s, r) => s + r.points, 0);
  const score = Math.min(100, raw);

  const band: RiskBand = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
  const decision: RiskDecision = band === 'high' ? 'deny' : band === 'medium' ? 'review' : 'allow';

  // Highest-contributing reason first for display.
  reasons.sort((a, b) => b.points - a.points);
  return { score, band, decision, reasons };
}
