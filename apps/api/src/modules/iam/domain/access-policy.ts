/**
 * ============================================================================
 *  Staff access policy — pure
 * ============================================================================
 *
 * Evaluated on every authenticated request (from the cached permission row),
 * so each rule takes effect without waiting for the token to expire:
 *  - contractor / temporary staff: access ends at access_expires_at (218, 219);
 *  - force logout: tokens issued before tokens_valid_after are refused (208);
 *  - login time window: e.g. Mon–Sat 08:00–20:00 IST, or an overnight shift
 *    22:00–06:00 that crosses midnight (215). The window's DAY is the day the
 *    shift STARTED, so an overnight Saturday shift still works at 02:00 Sunday.
 */
export interface LoginWindow {
  days: number[];
  startMinute: number;
  endMinute: number;
} // ISO days 1=Mon…7=Sun; minutes 0–1439

export type AccessDenial = 'expired' | 'session_revoked' | 'outside_login_window';

const IST_OFFSET_MIN = 330;

function localParts(now: Date, offsetMin: number): { isoDay: number; minute: number } {
  const t = new Date(now.getTime() + offsetMin * 60_000);
  const d = t.getUTCDay();
  return { isoDay: d === 0 ? 7 : d, minute: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export function validateWindow(w: LoginWindow): string | null {
  if (
    !Array.isArray(w.days) ||
    w.days.length === 0 ||
    w.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
  )
    return 'Choose at least one weekday (1=Mon … 7=Sun)';
  if (new Set(w.days).size !== w.days.length) return 'A weekday is listed twice';
  for (const m of [w.startMinute, w.endMinute])
    if (!Number.isInteger(m) || m < 0 || m > 1439) return 'Times must be between 00:00 and 23:59';
  if (w.startMinute === w.endMinute) return 'Start and end time cannot be the same';
  return null;
}

export function isWithinWindow(
  w: LoginWindow | null | undefined,
  now: Date,
  offsetMin = IST_OFFSET_MIN,
): boolean {
  if (!w) return true;
  const { isoDay, minute } = localParts(now, offsetMin);
  if (w.startMinute < w.endMinute)
    return w.days.includes(isoDay) && minute >= w.startMinute && minute < w.endMinute;
  // Overnight: evening part belongs to today, early-morning part to YESTERDAY's shift.
  if (minute >= w.startMinute) return w.days.includes(isoDay);
  if (minute < w.endMinute) return w.days.includes(isoDay === 1 ? 7 : isoDay - 1);
  return false;
}

export function evaluateAccess(input: {
  accessExpiresAt: Date | null;
  tokensValidAfter: Date | null;
  tokenIssuedAtSec: number | undefined;
  /** Millisecond issue time when the token carries one (tokens minted before it only have seconds). */
  tokenIssuedAtMs?: number;
  loginWindow: LoginWindow | null;
  now?: Date;
}): AccessDenial | null {
  const now = input.now ?? new Date();
  if (input.accessExpiresAt && input.accessExpiresAt <= now) return 'expired';
  if (
    input.tokensValidAfter &&
    (input.tokenIssuedAtMs ?? (input.tokenIssuedAtSec ?? Infinity) * 1000) <
      input.tokensValidAfter.getTime()
  )
    return 'session_revoked';
  if (!isWithinWindow(input.loginWindow, now)) return 'outside_login_window';
  return null;
}
