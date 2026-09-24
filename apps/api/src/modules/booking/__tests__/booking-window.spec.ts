import { describe, expect, it } from 'vitest';

import { checkBookingWindow } from '../domain/passenger-categories';

const now = new Date('2026-10-01T10:00:00Z');
const at = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe('checkBookingWindow (242/243)', () => {
  it('default: open until departure, no advance limit (existing behaviour unchanged)', () => {
    expect(checkBookingWindow(at(0.1), undefined, now)).toBeNull();
    expect(checkBookingWindow(at(24 * 400), undefined, now)).toBeNull();
    expect(checkBookingWindow(at(-1), undefined, now)).toMatch(/already departed/);
  });
  it('closes N minutes before departure', () => {
    expect(
      checkBookingWindow(at(0.5), { maxAdvanceDays: null, minMinutesBeforeDeparture: 60 }, now),
    ).toMatch(/closes 60 minutes/);
    expect(
      checkBookingWindow(at(2), { maxAdvanceDays: null, minMinutesBeforeDeparture: 60 }, now),
    ).toBeNull();
  });
  it('opens only N days ahead', () => {
    expect(
      checkBookingWindow(at(24 * 31), { maxAdvanceDays: 30, minMinutesBeforeDeparture: 0 }, now),
    ).toMatch(/open 30 days/);
    expect(
      checkBookingWindow(at(24 * 29), { maxAdvanceDays: 30, minMinutesBeforeDeparture: 0 }, now),
    ).toBeNull();
  });
});
