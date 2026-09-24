/**
 * ============================================================================
 *  Which fare plan applies to a journey date — pure
 * ============================================================================
 *
 * Operators layer tariffs: a regular plan, a weekend plan (weekdays = Sat,Sun),
 * a seasonal plan (Oct 20 – Nov 5), a special-day plan (Dec 31 only). For a
 * journey date, only plans whose date range AND weekday filter include that
 * date are eligible; among them the MOST SPECIFIC wins:
 *   1. the narrowest date window (special day beats season beats open-ended)
 *   2. then a weekday-restricted plan beats an every-day plan
 *   3. then the one that started most recently
 * So no priority numbers to maintain, and a new season can never silently
 * override every other day of the year (the bug this replaces: the newest
 * plan was used for ALL dates, even outside its own range).
 */
export interface FarePlanCandidate {
  id: string;
  effectiveFrom: string | null; // YYYY-MM-DD inclusive
  effectiveTo: string | null;   // YYYY-MM-DD inclusive
  weekdays: number[] | null;    // ISO 1=Mon … 7=Sun; null/empty = every day
}

export function isoWeekday(dateYmd: string): number {
  const d = new Date(`${dateYmd}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return d === 0 ? 7 : d;
}

const DAY = 86_400_000;
function windowDays(p: FarePlanCandidate): number {
  if (!p.effectiveFrom || !p.effectiveTo) return Number.POSITIVE_INFINITY;
  return Math.round((Date.parse(p.effectiveTo) - Date.parse(p.effectiveFrom)) / DAY) + 1;
}

export function appliesOn(p: FarePlanCandidate, dateYmd: string): boolean {
  if (p.effectiveFrom && dateYmd < p.effectiveFrom) return false;
  if (p.effectiveTo && dateYmd > p.effectiveTo) return false;
  if (p.weekdays && p.weekdays.length > 0 && !p.weekdays.includes(isoWeekday(dateYmd))) return false;
  return true;
}

export function selectFarePlan(plans: FarePlanCandidate[], dateYmd: string): FarePlanCandidate | null {
  const eligible = plans.filter((p) => appliesOn(p, dateYmd));
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    const w = windowDays(a) - windowDays(b);
    if (w !== 0 && Number.isFinite(w)) return w;
    if (Number.isFinite(windowDays(a)) !== Number.isFinite(windowDays(b))) return Number.isFinite(windowDays(a)) ? -1 : 1;
    const wa = a.weekdays?.length ? 1 : 0;
    const wb = b.weekdays?.length ? 1 : 0;
    if (wa !== wb) return wb - wa;
    return (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? '');
  })[0];
}

/** Validate a plan's date range / weekday filter before saving. Returns an error or null. */
export function validatePlanWindow(p: { effectiveFrom?: string | null; effectiveTo?: string | null; weekdays?: number[] | null }): string | null {
  if (p.effectiveFrom && p.effectiveTo && p.effectiveTo < p.effectiveFrom) return 'The end date cannot be before the start date';
  if (p.weekdays) {
    if (p.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return 'Weekdays must be 1 (Mon) to 7 (Sun)';
    if (new Set(p.weekdays).size !== p.weekdays.length) return 'A weekday is listed twice';
  }
  return null;
}
