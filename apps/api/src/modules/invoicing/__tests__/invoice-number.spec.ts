import { describe, expect, it } from 'vitest';

import { financialYear, formatInvoiceNumber, seriesKey } from '../domain/invoice-number';

describe('financialYear (India, Apr–Mar)', () => {
  it('May 2026 is FY 2026-27', () => {
    expect(financialYear(new Date('2026-05-01T00:00:00Z'))).toBe('2026-27');
  });

  it('Feb 2026 is FY 2025-26', () => {
    expect(financialYear(new Date('2026-02-15T00:00:00Z'))).toBe('2025-26');
  });

  it('edge: exactly 1 April flips to the new FY', () => {
    expect(financialYear(new Date('2026-04-01T00:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2026-03-31T00:00:00Z'))).toBe('2025-26');
  });

  it('edge: 31 December stays in the FY that started that April', () => {
    expect(financialYear(new Date('2026-12-31T00:00:00Z'))).toBe('2026-27');
  });
});

describe('formatInvoiceNumber', () => {
  it('formats prefix/FY/padded-sequence', () => {
    expect(formatInvoiceNumber({ prefix: 'INV', date: new Date('2026-05-01T00:00:00Z'), sequence: 123 })).toBe('INV/2026-27/000123');
  });

  it('sanitises the prefix and pads', () => {
    expect(formatInvoiceNumber({ prefix: 'orange-tvl', date: new Date('2026-05-01T00:00:00Z'), sequence: 7, pad: 4 })).toBe('ORANGETVL/2026-27/0007');
  });

  it('rejects a zero/negative sequence', () => {
    expect(() => formatInvoiceNumber({ prefix: 'INV', date: new Date(), sequence: 0 })).toThrow(/>= 1/);
  });
});

describe('seriesKey', () => {
  it('keys one sequence per (prefix, FY)', () => {
    expect(seriesKey('INV', new Date('2026-05-01T00:00:00Z'))).toBe('INV:2026-27');
    expect(seriesKey('INV', new Date('2026-02-01T00:00:00Z'))).toBe('INV:2025-26');
  });
});
