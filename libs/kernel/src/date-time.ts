import { BadRequestError } from './errors';
import type { Brand } from './types';

/**
 * ============================================================================
 *  Date & time model
 * ============================================================================
 *
 * Bus scheduling is the classic place where naive `Date` handling destroys a
 * system. Three distinct concepts must never be conflated:
 *
 *  1. **Instant** — an absolute point in time. Stored as `timestamptz`.
 *     Examples: when a booking was created, when a GPS ping arrived.
 *
 *  2. **LocalDate** — a calendar day with no timezone, `YYYY-MM-DD`.
 *     Stored as `date`. Example: the *journey date*. A passenger searching for
 *     "12 Jan" means 12 Jan in the origin's local calendar, full stop. If you
 *     store this as timestamptz you will serve the wrong day to anyone whose
 *     device clock is in another zone — a real and very common bug.
 *
 *  3. **LocalTime / minute-of-day** — `HH:MM` with no date, plus a `dayOffset`
 *     for services that arrive the next morning. Stored as `smallint`
 *     minutes-since-midnight, which sorts, indexes and adds trivially. A
 *     20:30 departure arriving 06:15 the next day is
 *     `{ departure: 1230, arrival: 375, dayOffset: 1 }`.
 *
 * The **instant** of a departure is derived, not stored:
 *     instant = toInstant(journeyDate, departureMinute, stop.timezone)
 * because a schedule authored months ahead must survive a government changing
 * the timezone rules (India doesn't have DST, but Nepal/Sri Lanka edge cases
 * and future geographies do).
 */

/** `YYYY-MM-DD`, timezone-free calendar day. */
export type LocalDate = Brand<string, 'LocalDate'>;

/** Minutes since local midnight, 0..1439. */
export type MinuteOfDay = Brand<number, 'MinuteOfDay'>;

/** IANA timezone identifier, e.g. `Asia/Kolkata`. */
export type TimeZone = Brand<string, 'TimeZone'>;

export const DEFAULT_TIMEZONE = 'Asia/Kolkata' as TimeZone;

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export const MINUTES_PER_DAY = 1440;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/* ── LocalDate ───────────────────────────────────────────────────────────── */

export function localDate(value: string): LocalDate {
  if (!LOCAL_DATE_RE.test(value)) {
    throw new BadRequestError(`Invalid date '${value}', expected YYYY-MM-DD`);
  }
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new BadRequestError(`Invalid calendar date '${value}'`);
  }
  return value as LocalDate;
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string' || !LOCAL_DATE_RE.test(value)) return false;
  try {
    localDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Today's calendar day in the given timezone. */
export function todayIn(tz: TimeZone = DEFAULT_TIMEZONE, now: Date = new Date()): LocalDate {
  return instantToLocalDate(now, tz);
}

/** The calendar day an instant falls on, in the given timezone. */
export function instantToLocalDate(instant: Date, tz: TimeZone = DEFAULT_TIMEZONE): LocalDate {
  const parts = zonedParts(instant, tz);
  return `${pad4(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}` as LocalDate;
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad4(next.getUTCFullYear())}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}` as LocalDate;
}

/** Whole days from `a` to `b` (b - a). Negative when b is earlier. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(
    (localDateToUtcMidnight(b).getTime() - localDateToUtcMidnight(a).getTime()) / MS_PER_DAY,
  );
}

export function compareLocalDate(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 0 = Sunday … 6 = Saturday. Matches Postgres `EXTRACT(DOW)`. */
export function dayOfWeek(date: LocalDate): number {
  return localDateToUtcMidnight(date).getUTCDay();
}

/** ISO weekday, 1 = Monday … 7 = Sunday. Used by the RRULE engine in Part 5. */
export function isoDayOfWeek(date: LocalDate): number {
  const dow = dayOfWeek(date);
  return dow === 0 ? 7 : dow;
}

/** Inclusive range of calendar days. Guarded against runaway ranges. */
export function eachDay(from: LocalDate, to: LocalDate, maxDays = 400): LocalDate[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];
  if (span + 1 > maxDays) {
    throw new BadRequestError(`Date range too large: ${span + 1} days (max ${maxDays})`);
  }
  const out: LocalDate[] = [];
  for (let i = 0; i <= span; i += 1) out.push(addDays(from, i));
  return out;
}

/* ── MinuteOfDay ─────────────────────────────────────────────────────────── */

/** Parse `HH:MM` (or `HH:MM:SS`) into minutes since midnight. */
export function minuteOfDay(value: string): MinuteOfDay {
  const match = TIME_RE.exec(value);
  if (!match) throw new BadRequestError(`Invalid time '${value}', expected HH:MM`);
  return (Number(match[1]) * 60 + Number(match[2])) as MinuteOfDay;
}

export function fromMinutes(minutes: number): MinuteOfDay {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new BadRequestError(`Minute-of-day out of range: ${minutes}`);
  }
  return minutes as MinuteOfDay;
}

/** Render minutes-since-midnight as `HH:MM`. */
export function formatMinuteOfDay(minute: MinuteOfDay | number): string {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Add a duration to a minute-of-day, returning the wrapped minute AND how many
 * calendar days were crossed. This is how arrival times and `dayOffset` on
 * route stops are computed.
 */
export function addMinutes(
  minute: MinuteOfDay | number,
  delta: number,
): {
  minute: MinuteOfDay;
  dayOffset: number;
} {
  const total = minute + delta;
  const dayOffset = Math.floor(total / MINUTES_PER_DAY);
  const wrapped = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return { minute: wrapped as MinuteOfDay, dayOffset };
}

/* ── Instant conversion ──────────────────────────────────────────────────── */

/**
 * Resolve `(journeyDate, minuteOfDay, dayOffset, timezone)` to an absolute
 * instant. Correct across DST transitions: we compute the zone's UTC offset at
 * a first-guess instant, correct, then re-check once (the standard two-pass
 * algorithm; a single pass is wrong for times near a transition).
 */
export function toInstant(
  date: LocalDate,
  minute: MinuteOfDay | number,
  tz: TimeZone = DEFAULT_TIMEZONE,
  dayOffset = 0,
): Date {
  const base = localDateToUtcMidnight(addDays(date, dayOffset)).getTime() + minute * MS_PER_MINUTE;
  let utc = base - offsetMsAt(new Date(base), tz);
  // Second pass: the offset may differ at the corrected instant (DST edge).
  utc = base - offsetMsAt(new Date(utc), tz);
  return new Date(utc);
}

/** Zone-aware `HH:MM` for an instant. */
export function formatInstantTime(instant: Date, tz: TimeZone = DEFAULT_TIMEZONE): string {
  const p = zonedParts(instant, tz);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** UTC offset in milliseconds for `tz` at `instant`. */
export function offsetMsAt(instant: Date, tz: TimeZone): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Discard sub-second noise from the formatter round-trip.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function isValidTimeZone(tz: string): tz is TimeZone {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function timeZone(value: string): TimeZone {
  if (!isValidTimeZone(value)) throw new BadRequestError(`Unknown IANA timezone '${value}'`);
  return value;
}

/* ── Durations ───────────────────────────────────────────────────────────── */

/** Humanise a minute count as `12h 45m` — used in search results. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export const Duration = {
  seconds: (n: number) => n * 1000,
  minutes: (n: number) => n * MS_PER_MINUTE,
  hours: (n: number) => n * MS_PER_HOUR,
  days: (n: number) => n * MS_PER_DAY,
} as const;

/* ── internals ───────────────────────────────────────────────────────────── */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Decompose an instant into wall-clock parts for a timezone.
 * `Intl.DateTimeFormat` is the only DST-correct primitive in the standard
 * library; the formatter is cached because constructing one costs ~30µs and
 * search endpoints call this thousands of times per request.
 */
function zonedParts(instant: Date, tz: TimeZone): ZonedParts {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(tz, fmt);
  }
  const parts = fmt.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function localDateToUtcMidnight(date: LocalDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}
