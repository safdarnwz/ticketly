import { describe, expect, it } from 'vitest';

import { isQuotaUsable, quotaReleaseAt, validatePhoneHoldUntil, validateQuotaAllocation } from '../domain/quota-rules';

const NOW = new Date('2026-09-23T10:00:00Z');
const DEP = new Date('2026-09-25T20:00:00Z'); // 2 days 10 h later
const ok = { seatNumbers: ['1A', '1B'], releaseMinutesBefore: 180, tripStatus: 'scheduled', departsAt: DEP, now: NOW };

describe('validateQuotaAllocation', () => {
  it('happy path', () => expect(() => validateQuotaAllocation(ok)).not.toThrow());
  it('release instant = departure − minutes', () => {
    expect(quotaReleaseAt(DEP, 180).toISOString()).toBe('2026-09-25T17:00:00.000Z');
  });
  it('negative: empty, blank, duplicate, too many seats', () => {
    expect(() => validateQuotaAllocation({ ...ok, seatNumbers: [] })).toThrow(/at least one/);
    expect(() => validateQuotaAllocation({ ...ok, seatNumbers: [' '] })).toThrow(/blank/);
    expect(() => validateQuotaAllocation({ ...ok, seatNumbers: ['1A', ' 1A'] })).toThrow(/more than once/);
    expect(() => validateQuotaAllocation({ ...ok, seatNumbers: Array.from({ length: 61 }, (_, i) => `S${i}`) })).toThrow(/At most 60/);
  });
  it('negative: departed/cancelled trip', () => {
    for (const s of ['departed', 'closed', 'cancelled']) expect(() => validateQuotaAllocation({ ...ok, tripStatus: s })).toThrow(/Cannot allocate/);
  });
  it('negative: release window out of range or already passed', () => {
    expect(() => validateQuotaAllocation({ ...ok, releaseMinutesBefore: 10 })).toThrow(/between/);
    expect(() => validateQuotaAllocation({ ...ok, releaseMinutesBefore: 8 * 1440 })).toThrow(/between/);
    expect(() => validateQuotaAllocation({ ...ok, releaseMinutesBefore: 3 * 1440 })).toThrow(/already passed/);
    expect(() => validateQuotaAllocation({ ...ok, releaseMinutesBefore: 90.5 })).toThrow(/whole minutes/);
  });
});

describe('isQuotaUsable', () => {
  const base = { releasedAt: null, consumedAt: null, releaseAt: new Date('2026-09-25T17:00:00Z') };
  it('usable until the release instant, not after, and never once released or consumed', () => {
    expect(isQuotaUsable(base, NOW)).toBe(true);
    expect(isQuotaUsable(base, new Date('2026-09-25T17:00:00Z'))).toBe(false);
    expect(isQuotaUsable({ ...base, releasedAt: NOW }, NOW)).toBe(false);
    expect(isQuotaUsable({ ...base, consumedAt: NOW }, NOW)).toBe(false);
  });
});

describe('validatePhoneHoldUntil', () => {
  it('happy path: tomorrow morning', () => expect(() => validatePhoneHoldUntil(new Date('2026-09-24T09:00:00Z'), DEP, NOW)).not.toThrow());
  it('negative: too soon, too long, too close to departure, invalid', () => {
    expect(() => validatePhoneHoldUntil(new Date('2026-09-23T10:02:00Z'), DEP, NOW)).toThrow(/at least 5 minutes/);
    expect(() => validatePhoneHoldUntil(new Date('2026-09-26T11:00:00Z'), new Date('2026-10-10T00:00:00Z'), NOW)).toThrow(/at most 72 hours/);
    expect(() => validatePhoneHoldUntil(new Date('2026-09-25T19:30:00Z'), DEP, NOW)).toThrow(/before departure/);
    expect(() => validatePhoneHoldUntil(new Date('nope'), DEP, NOW)).toThrow(/valid/);
  });
});
