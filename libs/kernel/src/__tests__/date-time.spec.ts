import { describe, expect, it } from 'vitest';

import {
  addMinutes,
  formatMinuteOfDay,
  isoDayOfWeek,
  localDate,
  minuteOfDay,
  toInstant,
} from '../date-time';

describe('date-time', () => {
  it('parses HH:MM into minutes since midnight', () => {
    expect(minuteOfDay('20:30')).toBe(1230);
    expect(formatMinuteOfDay(375)).toBe('06:15');
  });

  it('wraps overnight arrivals with a day offset', () => {
    const result = addMinutes(minuteOfDay('20:30'), 585); // +9h45m
    expect(formatMinuteOfDay(result.minute)).toBe('06:15');
    expect(result.dayOffset).toBe(1);
  });

  it('resolves a journey instant in the origin timezone', () => {
    const instant = toInstant(localDate('2026-03-15'), minuteOfDay('20:30'), 'Asia/Kolkata' as never);
    // 20:30 IST == 15:00 UTC
    expect(instant.toISOString()).toBe('2026-03-15T15:00:00.000Z');
  });

  it('computes ISO weekday for the RRULE engine', () => {
    expect(isoDayOfWeek(localDate('2026-03-15'))).toBe(7); // a Sunday
    expect(isoDayOfWeek(localDate('2026-03-16'))).toBe(1); // a Monday
  });

  it('rejects invalid calendar dates', () => {
    expect(() => localDate('2026-02-30')).toThrow();
  });
});
