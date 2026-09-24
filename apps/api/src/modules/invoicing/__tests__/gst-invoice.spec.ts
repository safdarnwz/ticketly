import { describe, expect, it } from 'vitest';

import { computeGstInvoice, type InvoiceLineInput } from '../domain/gst-invoice';

const line = (taxableMinor: number, gstRatePct = 5): InvoiceLineInput => ({
  description: 'Bus fare',
  sac: '9964',
  taxableMinor,
  gstRatePct,
});

describe('computeGstInvoice — intra-state (CGST+SGST)', () => {
  it('splits 5% into CGST 2.5% + SGST 2.5% and foots exactly', () => {
    const inv = computeGstInvoice({ lines: [line(100000)], interState: false });
    expect(inv.taxableMinor).toBe(100000);
    expect(inv.taxLines.map((t) => t.name)).toEqual(['CGST', 'SGST']);
    expect(inv.taxLines[0].amountMinor + inv.taxLines[1].amountMinor).toBe(5000);
    expect(inv.totalMinor).toBe(inv.taxableMinor + inv.taxTotalMinor + inv.roundOffMinor);
  });

  it('CGST+SGST sum exactly even on an odd tax amount', () => {
    // 5% of 99900 = 4995 → CGST 2498 + SGST 2497 = 4995
    const inv = computeGstInvoice({ lines: [line(99900)], interState: false });
    expect(inv.taxLines[0].amountMinor + inv.taxLines[1].amountMinor).toBe(4995);
  });
});

describe('computeGstInvoice — inter-state (IGST)', () => {
  it('uses a single IGST line at the full rate', () => {
    const inv = computeGstInvoice({ lines: [line(100000)], interState: true });
    expect(inv.taxLines).toHaveLength(1);
    expect(inv.taxLines[0].name).toBe('IGST');
    expect(inv.taxLines[0].amountMinor).toBe(5000);
  });
});

describe('computeGstInvoice — rounding & multi-line', () => {
  it('rounds the total to the nearest rupee with a round-off line', () => {
    // taxable 12345, 5% = 617.25 → 61725 paise? no: 12345*5% = 617 (rounded)
    const inv = computeGstInvoice({ lines: [line(12345)], interState: true });
    // grand total rounds to nearest 100 paise
    expect(inv.totalMinor % 100).toBe(0);
    expect(inv.taxableMinor + inv.taxTotalMinor + inv.roundOffMinor).toBe(inv.totalMinor);
  });

  it('sums multiple lines', () => {
    const inv = computeGstInvoice({ lines: [line(100000), line(20000, 5)], interState: false });
    expect(inv.taxableMinor).toBe(120000);
    expect(inv.taxTotalMinor).toBe(6000); // 5% of 120000
  });

  it('the identity taxable + tax + roundoff == total ALWAYS holds', () => {
    const inv = computeGstInvoice({ lines: [line(87654, 5), line(3333, 12)], interState: false });
    expect(inv.taxableMinor + inv.taxTotalMinor + inv.roundOffMinor).toBe(inv.totalMinor);
  });
});

describe('computeGstInvoice — negative & edge', () => {
  it('rejects an empty invoice', () => {
    expect(() => computeGstInvoice({ lines: [], interState: false })).toThrow(/at least one line/);
  });

  it('rejects a negative taxable value', () => {
    expect(() => computeGstInvoice({ lines: [line(-1)], interState: false })).toThrow(/negative/);
  });

  it('edge: zero-rated (exempt) line has no tax', () => {
    const inv = computeGstInvoice({ lines: [line(100000, 0)], interState: false });
    expect(inv.taxTotalMinor).toBe(0);
  });
});
