import type { LocalDate } from '@kernel';

/**
 * ============================================================================
 *  Payout schedule — twice a week, fixed windows
 * ============================================================================
 *
 *   Booking window        Payout day
 *   Mon, Tue, Wed    →    Thursday (same week)
 *   Thu, Fri, Sat, Sun →  Monday (following week)
 *
 * Pure and date-only (no time-of-day) so it's exhaustively testable and the
 * worker can call it once a day without worrying about timezones inside this
 * function — the CALLER passes a `LocalDate` already resolved in the
 * business's operating timezone (see PayoutScheduler).
 *
 * Returns null on any day that isn't a payout day — Mon/Thu are the only two
 * days this ever returns a window for, by design: running the scheduler more
 * than once a day is harmless (SettlementService.generate is idempotent per
 * period), but there is still only ever one CORRECT window per payout day.
 */
export interface PayoutWindow {
  periodFrom: LocalDate;
  periodTo: LocalDate;
}

const DAY_MS = 86_400_000;

export function payoutWindowFor(today: Date): PayoutWindow | null {
  const dow = today.getUTCDay(); // 0=Sun..6=Sat, using UTC so callers pass an already-zoned midnight
  if (dow === 4) {
    // Thursday → settle this week's Monday through Wednesday.
    return {
      periodFrom: toLocalDate(addDays(today, -3)), // Monday
      periodTo: toLocalDate(addDays(today, -1)),   // Wednesday
    };
  }
  if (dow === 1) {
    // Monday → settle last week's Thursday through Sunday.
    return {
      periodFrom: toLocalDate(addDays(today, -4)), // last Thursday
      periodTo: toLocalDate(addDays(today, -1)),   // yesterday, Sunday
    };
  }
  return null;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function toLocalDate(d: Date): LocalDate {
  return d.toISOString().slice(0, 10) as LocalDate;
}
