import { describe, expect, it } from 'vitest';

import { computePnl, sumPnl, validateExpense } from '../domain/pnl';

const DEP = new Date('2026-09-20T20:00:00Z');
const base = { category: 'diesel', amountMinor: 1_200_000, tripStatus: 'closed', tripDepartsAt: DEP, now: new Date('2026-09-23T10:00:00Z') };

describe('validateExpense', () => {
  it('happy path', () => expect(() => validateExpense(base)).not.toThrow());
  it('negative: unknown category, zero/negative/fractional amount, absurd amount', () => {
    expect(() => validateExpense({ ...base, category: 'party' })).toThrow(/Unknown/);
    for (const a of [0, -5, 10.5]) expect(() => validateExpense({ ...base, amountMinor: a })).toThrow(/positive whole/);
    expect(() => validateExpense({ ...base, amountMinor: 5_00_000_01 })).toThrow(/unusually large/);
  });
  it('"other" needs a description', () => {
    expect(() => validateExpense({ ...base, category: 'other' })).toThrow(/Describe/);
    expect(() => validateExpense({ ...base, category: 'other', note: 'Tyre puncture' })).not.toThrow();
  });
  it('cancelled trip, and too late after the trip', () => {
    expect(() => validateExpense({ ...base, tripStatus: 'cancelled' })).toThrow(/cancelled/);
    expect(() => validateExpense({ ...base, now: new Date('2026-10-10T00:00:00Z') })).toThrow(/15 days/);
  });
});

describe('computePnl', () => {
  it('GST is not income; commission and expenses come off', () => {
    const p = computePnl({ salesMinor: 105000_00, gstMinor: 5000_00, commissionMinor: 10000_00, commissionGstMinor: 1800_00, expensesMinor: 40000_00, seatsSold: 30, seatsTotal: 40 });
    expect(p.netFareMinor).toBe(100000_00);
    expect(p.netRevenueMinor).toBe(88200_00);
    expect(p.profitMinor).toBe(48200_00);
    expect(p.marginPct).toBe(48.2);
    expect(p.occupancyPct).toBe(75);
    expect(p.costPerSeatMinor).toBe(133333);
  });
  it('edge: an empty bus is a pure loss; no divide-by-zero', () => {
    const p = computePnl({ salesMinor: 0, gstMinor: 0, commissionMinor: 0, commissionGstMinor: 0, expensesMinor: 25000_00, seatsSold: 0, seatsTotal: 40 });
    expect(p.profitMinor).toBe(-25000_00);
    expect(p.marginPct).toBeNull();
    expect(p.costPerSeatMinor).toBeNull();
    expect(computePnl({ ...p, seatsTotal: 0 }).occupancyPct).toBeNull();
  });
  it('sumPnl adds trips, then recomputes ratios (never averages percentages)', () => {
    const a = { salesMinor: 1000, gstMinor: 0, commissionMinor: 0, commissionGstMinor: 0, expensesMinor: 0, seatsSold: 10, seatsTotal: 10 };
    const b = { ...a, salesMinor: 0, expensesMinor: 500, seatsSold: 0 };
    const t = sumPnl([a, b]);
    expect(t.profitMinor).toBe(500);
    expect(t.occupancyPct).toBe(50);
    expect(t.marginPct).toBe(50);
  });
});
