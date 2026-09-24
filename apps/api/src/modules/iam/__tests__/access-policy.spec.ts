import { describe, expect, it } from 'vitest';

import { evaluateAccess, isWithinWindow, validateWindow } from '../domain/access-policy';

// Times given in UTC; IST = UTC+5:30.
const ist = (isoLocal: string) => new Date(new Date(`${isoLocal}Z`).getTime() - 330 * 60_000);
const office = { days: [1, 2, 3, 4, 5, 6], startMinute: 8 * 60, endMinute: 20 * 60 };
const night = { days: [6], startMinute: 22 * 60, endMinute: 6 * 60 }; // Saturday night shift

describe('login time window (215)', () => {
  it('office hours Mon–Sat 08:00–20:00 IST', () => {
    expect(isWithinWindow(office, ist('2026-10-05T09:00:00'))).toBe(true);   // Monday 09:00
    expect(isWithinWindow(office, ist('2026-10-05T20:00:00'))).toBe(false);  // end is exclusive
    expect(isWithinWindow(office, ist('2026-10-04T10:00:00'))).toBe(false);  // Sunday
  });
  it('overnight shift crossing midnight belongs to the day it started', () => {
    expect(isWithinWindow(night, ist('2026-10-03T23:30:00'))).toBe(true);    // Sat 23:30
    expect(isWithinWindow(night, ist('2026-10-04T02:00:00'))).toBe(true);    // Sun 02:00 = Saturday's shift
    expect(isWithinWindow(night, ist('2026-10-04T23:00:00'))).toBe(false);   // Sun night: not a shift day
    expect(isWithinWindow(night, ist('2026-10-04T07:00:00'))).toBe(false);
  });
  it('no window = always; invalid windows are rejected', () => {
    expect(isWithinWindow(null, new Date())).toBe(true);
    expect(validateWindow({ days: [], startMinute: 0, endMinute: 60 })).toMatch(/weekday/);
    expect(validateWindow({ days: [1, 1], startMinute: 0, endMinute: 60 })).toMatch(/twice/);
    expect(validateWindow({ days: [1], startMinute: 600, endMinute: 600 })).toMatch(/same/);
    expect(validateWindow({ days: [1], startMinute: 0, endMinute: 1440 })).toMatch(/00:00 and 23:59/);
  });
});

describe('evaluateAccess', () => {
  const now = new Date('2026-10-05T06:00:00Z');
  it('contractor access expiry (218/219)', () => {
    expect(evaluateAccess({ accessExpiresAt: new Date('2026-10-05T05:59:59Z'), tokensValidAfter: null, tokenIssuedAtSec: 0, loginWindow: null, now })).toBe('expired');
    expect(evaluateAccess({ accessExpiresAt: new Date('2026-10-06T00:00:00Z'), tokensValidAfter: null, tokenIssuedAtSec: 0, loginWindow: null, now })).toBeNull();
  });
  it('force logout (208): tokens issued before the cut-off are refused, new ones work', () => {
    const cut = new Date('2026-10-05T05:00:00Z');
    expect(evaluateAccess({ accessExpiresAt: null, tokensValidAfter: cut, tokenIssuedAtSec: cut.getTime() / 1000 - 60, loginWindow: null, now })).toBe('session_revoked');
    expect(evaluateAccess({ accessExpiresAt: null, tokensValidAfter: cut, tokenIssuedAtSec: cut.getTime() / 1000 + 60, loginWindow: null, now })).toBeNull();
  });
});
