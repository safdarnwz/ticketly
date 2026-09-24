import { describe, it, expect } from 'vitest';

import {
  retentionDeadlineMs, isDueForPurge, redactPii, erasureActionFor, DEFAULT_PII_FIELDS,
  type RetentionPolicy,
} from '../domain/retention';

const DAY = 86_400_000;

describe('retention window', () => {
  it('happy: deadline is created + retentionDays', () => {
    expect(retentionDeadlineMs(0, 30)).toBe(30 * DAY);
  });
  it('positive/negative: due only at or after the deadline', () => {
    expect(isDueForPurge(0, 30, 30 * DAY - 1)).toBe(false);
    expect(isDueForPurge(0, 30, 30 * DAY)).toBe(true);
  });
  it('negative: negative retention throws', () => {
    expect(() => retentionDeadlineMs(0, -1)).toThrow();
  });
});

describe('redactPii', () => {
  it('happy: redacts PII fields, leaves financial fields intact, does not mutate input', () => {
    const rec = { bookingId: 'b1', fullName: 'A Traveller', email: 'a@x.com', totalMinor: 50000 };
    const out = redactPii(rec);
    expect(out.fullName).toBe('[redacted]');
    expect(out.email).toBe('[redacted]');
    expect(out.totalMinor).toBe(50000);
    expect(out.bookingId).toBe('b1');
    expect(rec.fullName).toBe('A Traveller'); // original untouched
  });

  it('edge: absent or null PII fields are left alone', () => {
    const out = redactPii({ email: null, totalMinor: 1 } as Record<string, unknown>);
    expect(out.email).toBeNull();
  });

  it('positive: DEFAULT_PII_FIELDS covers the common contact fields', () => {
    expect(DEFAULT_PII_FIELDS).toContain('contactPhone');
    expect(DEFAULT_PII_FIELDS).toContain('email');
  });
});

describe('erasureActionFor', () => {
  it('anonymises financial categories, deletes the rest', () => {
    const fin: RetentionPolicy = { category: 'invoices', retentionDays: 2920, anonymiseInsteadOfDelete: true };
    const prof: RetentionPolicy = { category: 'profile', retentionDays: 0, anonymiseInsteadOfDelete: false };
    expect(erasureActionFor(fin)).toBe('anonymise');
    expect(erasureActionFor(prof)).toBe('delete');
  });
});
