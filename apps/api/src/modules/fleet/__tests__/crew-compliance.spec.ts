import { describe, expect, it } from 'vitest';

import {
  checkAssignment,
  isOverridable,
  RECOMMENDED_REST_RULES,
  remainingAllowance,
  resolveAttendance,
  type Duty,
} from '../domain/duty-roster';

const H = 3_600_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');
const duty = (id: string, startH: number, endH: number, drivingMin: number): Duty => ({
  id,
  crewId: 'c',
  startMs: T0 + startH * H,
  endMs: T0 + endH * H,
  drivingMinutes: drivingMin,
});

describe('continuous driving (1406 / 1595)', () => {
  it('a single 7h-driving duty breaks the 5h continuous limit; 4h is fine', () => {
    expect(
      checkAssignment(duty('x', 20, 28, 7 * 60), [], RECOMMENDED_REST_RULES).conflicts.map(
        (c) => c.kind,
      ),
    ).toContain('exceeds_continuous_driving');
    expect(checkAssignment(duty('x', 20, 25, 4 * 60), [], RECOMMENDED_REST_RULES).ok).toBe(true);
    // Base defaults are unchanged (backward compatible): no continuous limit.
    expect(checkAssignment(duty('x', 20, 28, 7 * 60), []).ok).toBe(true);
  });
  it('limit is configurable per operator', () => {
    expect(
      checkAssignment(duty('x', 20, 28, 7 * 60), [], {
        minRestMinutes: 480,
        maxDailyDrivingMinutes: 600,
        maxDutyMinutes: 960,
        maxContinuousDrivingMinutes: 8 * 60,
      }).ok,
    ).toBe(true);
  });
});

describe('double-duty approval (594 / 1408 / 6506)', () => {
  it('rest / limit breaches can be approved; an overlap never can', () => {
    const rest = checkAssignment(duty('b', 10, 14, 3 * 60), [duty('a', 2, 8, 5 * 60)]); // only 2h rest
    expect(rest.conflicts.map((c) => c.kind)).toContain('insufficient_rest');
    expect(isOverridable(rest.conflicts)).toBe(true);
    const clash = checkAssignment(duty('b', 5, 9, 3 * 60), [duty('a', 2, 8, 5 * 60)]);
    expect(isOverridable(clash.conflicts)).toBe(false);
    expect(isOverridable([])).toBe(false);
  });
});

describe('remaining allowable driving (1909)', () => {
  it('10h daily cap minus what was driven in the last 24h; next rested time', () => {
    const r = remainingAllowance([duty('a', 0, 6, 5 * 60)], T0 + 7 * H);
    expect(r.remainingDrivingMinutes).toBe(5 * 60);
    expect(r.nextAvailableAtMs).toBe(T0 + 14 * H); // 06:00 + 8h rest
  });
  it('fully rested crew', () => {
    expect(remainingAllowance([], T0)).toEqual({
      remainingDrivingMinutes: 600,
      nextAvailableAtMs: null,
    });
  });
});

describe('attendance (591 / 592 / 6501)', () => {
  const start = T0 + 20 * H;
  const end = T0 + 28 * H;
  it('present within grace, late after 15 min, absent any time before the end', () => {
    expect(
      resolveAttendance({
        requested: 'present',
        dutyStartMs: start,
        markedAtMs: start + 10 * 60_000,
        dutyEndMs: end,
      }),
    ).toBe('present');
    expect(
      resolveAttendance({
        requested: 'present',
        dutyStartMs: start,
        markedAtMs: start + 40 * 60_000,
        dutyEndMs: end,
      }),
    ).toBe('late');
    expect(
      resolveAttendance({
        requested: 'absent',
        dutyStartMs: start,
        markedAtMs: start,
        dutyEndMs: end,
      }),
    ).toBe('absent');
  });
  it('cannot mark after the duty ended, or too early', () => {
    expect(() =>
      resolveAttendance({
        requested: 'present',
        dutyStartMs: start,
        markedAtMs: end + 1,
        dutyEndMs: end,
      }),
    ).toThrow(/already ended/);
    expect(() =>
      resolveAttendance({
        requested: 'present',
        dutyStartMs: start,
        markedAtMs: start - 7 * H,
        dutyEndMs: end,
      }),
    ).toThrow(/6 hours/);
  });
});
