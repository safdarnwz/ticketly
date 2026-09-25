import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Byte-for-byte the SAME derivation as the backend's GeographyRepository.
 * findBySlug() SQL expression — remove anything that isn't a letter,
 * digit, space or hyphen, collapse whitespace to a single hyphen, then
 * lower-case. Both sides MUST stay identical: this is what lets
 * `/results?from=new-delhi` (built here) resolve back to the right city
 * on the backend, without a stored slug column that could drift out of
 * sync with the city's actual name.
 */
export function slugifyCityName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
}

/** Tailwind-aware className combiner. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const CURRENCY_SCALE: Record<string, number> = { INR: 2, USD: 2, EUR: 2, GBP: 2, JPY: 0, KWD: 3, AED: 2 };
const CURRENCY_SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AED: 'د.إ' };

/** Format integer minor units as a money string (Indian grouping for INR). */
export function formatMoney(minor: number, currency = 'INR'): string {
  const scale = CURRENCY_SCALE[currency] ?? 2;
  const sym = CURRENCY_SYMBOL[currency] ?? currency + ' ';
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const factor = 10 ** scale;
  const whole = Math.floor(abs / factor);
  const frac = abs - whole * factor;
  const group =
    currency === 'INR'
      ? whole.toString().replace(/(\d)(?=(\d\d)+\d$)/g, '$1,')
      : whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = scale > 0 ? '.' + String(frac).padStart(scale, '0') : '';
  return `${neg ? '-' : ''}${sym}${group}${fracStr}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Bus times are shown in the operators' timezone (the backend's
 * DEFAULT_TIMEZONE), not the viewer's browser zone — a 21:00 departure
 * from Delhi is 21:00 wherever the customer happens to be.
 */
export const APP_TIMEZONE = 'Asia/Kolkata';

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: APP_TIMEZONE });
}

/** YYYY-MM-DD of an instant in APP_TIMEZONE. */
export function localDateOf(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(date);
}

/** Today in APP_TIMEZONE, as YYYY-MM-DD. */
export function todayLocal(): string {
  return localDateOf(new Date());
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic, no timezone drift). */
export function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** "Fri, 26 Sep" for a YYYY-MM-DD date. */
export function formatDateLabel(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: '2-digit', month: 'short' }): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
}

/** Days between the local dates of two instants (0 = same day, 1 = arrives next day…). */
export function dayDiff(fromIso: string, toIso: string): number {
  const a = localDateOf(fromIso);
  const b = localDateOf(toIso);
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export const SEAT_TYPE_LABEL: Record<string, string> = {
  seater: 'Seater',
  sleeper: 'Sleeper',
  semi_sleeper: 'Semi-sleeper',
};

export function minutesToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Idempotency-Key helper for write requests. */
export function idempotencyKey(prefix = 'web'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
