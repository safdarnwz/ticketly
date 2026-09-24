import {
  compareLocalDate,
  daysBetween,
  DomainError,
  eachDay,
  ErrorCode,
  isoDayOfWeek,
  type LocalDate,
} from '@kernel';

/**
 * ============================================================================
 *  Service recurrence — which dates a scheduled service actually runs
 * ============================================================================
 *
 * A "service" is a recurring template ("the 20:30 Hyderabad→Chennai, daily
 * except Tuesdays, from 1 Apr to 30 Sep"). Materialising it produces concrete,
 * dated **trips** the inventory and booking engines operate on.
 *
 * We model recurrence with a small, RRULE-inspired rule set that covers what
 * bus operators actually need, kept deliberately simpler than full iCalendar
 * RRULE (which is a swamp of edge cases no operator uses):
 *
 *   frequency : 'daily' | 'weekly'
 *   weekdays  : for weekly — ISO 1..7 (Mon..Sun) the service runs
 *   interval  : every N days/weeks (default 1)
 *   window    : [startDate, endDate] the rule is valid within
 *   exceptions: specific dates to SKIP (festivals, one-off cancellations)
 *   additions : specific extra dates to ADD (a special one-off run)
 *
 * Everything is pure `LocalDate` math and heavily tested. Materialisation is
 * bounded (`maxDays`) so a mis-configured rule can never try to generate ten
 * years of trips.
 */

export type Frequency = 'daily' | 'weekly';

export interface RecurrenceRule {
  frequency: Frequency;
  /** ISO weekdays 1..7 (Mon..Sun). Required for 'weekly', ignored for 'daily'. */
  weekdays?: number[];
  /** Every N periods. Default 1. */
  interval?: number;
  startDate: LocalDate;
  endDate: LocalDate;
  /** Dates to skip even though the rule would include them. */
  exceptions?: LocalDate[];
  /** One-off extra dates to include even though the rule would exclude them. */
  additions?: LocalDate[];
}

/**
 * Expand a rule into the concrete dates it runs on, within
 * `[windowStart, windowEnd]` (the materialisation horizon), inclusive.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  windowStart: LocalDate,
  windowEnd: LocalDate,
  maxDays = 400,
): LocalDate[] {
  validateRule(rule);

  // Clamp the expansion window to the rule's own validity window.
  const from = compareLocalDate(windowStart, rule.startDate) > 0 ? windowStart : rule.startDate;
  const to = compareLocalDate(windowEnd, rule.endDate) < 0 ? windowEnd : rule.endDate;
  if (compareLocalDate(from, to) > 0) return [];

  const interval = rule.interval ?? 1;
  const exceptions = new Set(rule.exceptions ?? []);
  const weekdays = new Set(rule.weekdays ?? []);

  const candidateDays = eachDay(from, to, maxDays);
  const result: LocalDate[] = [];

  for (const date of candidateDays) {
    if (exceptions.has(date)) continue;

    let included = false;
    if (rule.frequency === 'daily') {
      // Every `interval` days from the rule's start.
      included = daysBetween(rule.startDate, date) % interval === 0;
    } else {
      // Weekly: the date's weekday is in the set AND the week is on-interval.
      if (weekdays.has(isoDayOfWeek(date))) {
        const weeksFromStart = Math.floor(daysBetween(rule.startDate, date) / 7);
        included = weeksFromStart % interval === 0;
      }
    }

    if (included) result.push(date);
  }

  // Merge one-off additions that fall inside the window and aren't already there.
  const existing = new Set(result);
  for (const extra of rule.additions ?? []) {
    if (
      !existing.has(extra) &&
      compareLocalDate(extra, from) >= 0 &&
      compareLocalDate(extra, to) <= 0 &&
      !exceptions.has(extra)
    ) {
      result.push(extra);
    }
  }

  result.sort(compareLocalDate);
  return result;
}

/**
 * Which dates in the target window still need trips created, given the dates
 * already materialised. This is what the daily materialisation job computes so
 * it only ever inserts the delta, never re-creates existing trips.
 */
export function datesToMaterialise(
  rule: RecurrenceRule,
  windowStart: LocalDate,
  windowEnd: LocalDate,
  alreadyMaterialised: Iterable<LocalDate>,
  maxDays = 400,
): LocalDate[] {
  const have = new Set(alreadyMaterialised);
  return expandRecurrence(rule, windowStart, windowEnd, maxDays).filter((d) => !have.has(d));
}

/** Does the service run on this specific date? */
export function runsOn(rule: RecurrenceRule, date: LocalDate): boolean {
  return expandRecurrence(rule, date, date).length > 0;
}

function validateRule(rule: RecurrenceRule): void {
  if (compareLocalDate(rule.startDate, rule.endDate) > 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Recurrence startDate is after endDate');
  }
  if ((rule.interval ?? 1) < 1) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Recurrence interval must be >= 1');
  }
  if (rule.frequency === 'weekly') {
    const days = rule.weekdays ?? [];
    if (days.length === 0) {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'A weekly service must specify at least one weekday',
      );
    }
    if (days.some((d) => d < 1 || d > 7)) {
      throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Weekdays must be ISO 1..7 (Mon..Sun)');
    }
  }
}
