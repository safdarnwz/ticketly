/**
 * Branch opening hours (#129). One entry per weekday; a missing or null day
 * is closed. `close` earlier than `open` means the counter stays open past
 * midnight (a night-bus stand: 20:00 → 02:00).
 */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayHours {
  open: string;
  close: string;
}

export type WorkingHours = Partial<Record<Weekday, DayHours | null>>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function workingHoursErrors(hours: WorkingHours): string[] {
  const errors: string[] = [];
  for (const [day, h] of Object.entries(hours)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) {
      errors.push(`unknown day '${day}'`);
      continue;
    }
    if (!h) continue;
    if (!HHMM.test(h.open) || !HHMM.test(h.close)) errors.push(`${day}: times are HH:MM (24-hour)`);
    else if (h.open === h.close) errors.push(`${day}: opening and closing time are the same`);
  }
  return errors;
}

/** Is the branch open at this weekday + local time ("HH:MM")? */
export function isOpenAt(hours: WorkingHours, day: Weekday, time: string): boolean {
  const today = hours[day];
  if (today) {
    if (today.open < today.close) {
      if (time >= today.open && time < today.close) return true;
    } else if (time >= today.open) return true; // opened today, closes after midnight
  }
  const prev = hours[WEEKDAYS[(WEEKDAYS.indexOf(day) + 6) % 7]];
  return Boolean(prev && prev.close < prev.open && time < prev.close);
}
