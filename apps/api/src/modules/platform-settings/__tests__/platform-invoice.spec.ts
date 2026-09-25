import { describe, expect, it } from 'vitest';

import { financialYear, invoiceTotals, platformInvoiceNumber } from '../domain/platform-invoice';

const lines = [
  { kind: 'booking_commission', description: '', count: 10, baseMinor: 10_000, gstMinor: 1_800 },
  { kind: 'per_bus_fee', description: '', count: 1, baseMinor: 90_000, gstMinor: 0 },
];

describe('invoiceTotals', () => {
  it('adds lines without discounts', () => {
    expect(invoiceTotals(lines, [])).toEqual({
      subtotalMinor: 100_000,
      discountMinor: 0,
      gstMinor: 1_800,
      totalMinor: 101_800,
      discountIds: [],
    });
  });

  it('applies percent then flat discounts and scales GST to the discounted value', () => {
    const t = invoiceTotals(lines, [
      { id: 'a', kind: 'flat', value: 5_000 },
      { id: 'b', kind: 'percent', value: 10 },
    ]);
    expect(t.discountMinor).toBe(15_000);
    expect(t.gstMinor).toBe(1_530); // 1800 × 85 000 / 100 000
    expect(t.totalMinor).toBe(86_530);
    expect(t.discountIds).toEqual(['b', 'a']);
  });

  it('never discounts below zero', () => {
    const t = invoiceTotals(lines, [{ id: 'x', kind: 'flat', value: 1_000_000 }]);
    expect(t.discountMinor).toBe(100_000);
    expect(t.totalMinor).toBe(0);
  });
});

describe('financialYear', () => {
  it('April starts the Indian financial year', () => {
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2099-12-31')).toBe('2099-00');
  });

  it('numbers invoices per year', () => {
    expect(platformInvoiceNumber('2026-27', 42)).toBe('TKT/2026-27/000042');
  });
});
