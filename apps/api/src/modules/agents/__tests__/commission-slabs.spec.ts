import { describe, expect, it } from 'vitest';

import { monthStart, rateFor, validateSlabs } from '../domain/commission-slabs';

const L = 100_000_00; // ₹1 lakh in paise
const slabs = [
  { minMonthlySalesMinor: 0, commissionPct: 5 },
  { minMonthlySalesMinor: L, commissionPct: 6 },
  { minMonthlySalesMinor: 5 * L, commissionPct: 7.5 },
];

describe('validateSlabs', () => {
  it('sorts and accepts a proper table', () => {
    expect(validateSlabs([...slabs].reverse())[0].minMonthlySalesMinor).toBe(0);
  });
  it('negative: empty, no zero start, duplicate threshold, decreasing rate, bad values', () => {
    expect(() => validateSlabs([])).toThrow(/at least one/);
    expect(() => validateSlabs([{ minMonthlySalesMinor: L, commissionPct: 5 }])).toThrow(
      /start at ₹0/,
    );
    expect(() =>
      validateSlabs([
        { minMonthlySalesMinor: 0, commissionPct: 5 },
        { minMonthlySalesMinor: 0, commissionPct: 6 },
      ]),
    ).toThrow(/same threshold/);
    expect(() =>
      validateSlabs([
        { minMonthlySalesMinor: 0, commissionPct: 6 },
        { minMonthlySalesMinor: L, commissionPct: 5 },
      ]),
    ).toThrow(/lower commission/);
    expect(() => validateSlabs([{ minMonthlySalesMinor: 0, commissionPct: 51 }])).toThrow(
      /between 0% and 50%/,
    );
    expect(() => validateSlabs([{ minMonthlySalesMinor: 0, commissionPct: 5.555 }])).toThrow(
      /2 decimals/,
    );
    expect(() => validateSlabs([{ minMonthlySalesMinor: -1, commissionPct: 5 }])).toThrow(
      /zero or more/,
    );
  });
});

describe('rateFor', () => {
  it('picks the slab reached BEFORE this ticket (boundary inclusive)', () => {
    expect(
      rateFor({ agentSlabs: slabs, operatorSlabs: [], flatPct: 3, monthSalesMinor: 0 }).pct,
    ).toBe(5);
    expect(
      rateFor({ agentSlabs: slabs, operatorSlabs: [], flatPct: 3, monthSalesMinor: L - 1 }).pct,
    ).toBe(5);
    expect(
      rateFor({ agentSlabs: slabs, operatorSlabs: [], flatPct: 3, monthSalesMinor: L }).pct,
    ).toBe(6);
    expect(
      rateFor({ agentSlabs: slabs, operatorSlabs: [], flatPct: 3, monthSalesMinor: 9 * L }).pct,
    ).toBe(7.5);
  });
  it('precedence: agent slabs → operator default slabs → flat', () => {
    expect(
      rateFor({ agentSlabs: [], operatorSlabs: slabs, flatPct: 3, monthSalesMinor: L }).source,
    ).toBe('operator_slab');
    expect(rateFor({ agentSlabs: [], operatorSlabs: [], flatPct: 3, monthSalesMinor: L })).toEqual({
      pct: 3,
      source: 'flat',
    });
  });
});

describe('monthStart (IST)', () => {
  it('00:30 IST on the 1st belongs to the NEW month even though it is still the previous day in UTC', () => {
    expect(monthStart(new Date('2026-09-30T19:00:00Z')).toISOString()).toBe(
      '2026-09-30T18:30:00.000Z',
    ); // = 1 Oct 00:00 IST
    expect(monthStart(new Date('2026-09-15T10:00:00Z')).toISOString()).toBe(
      '2026-08-31T18:30:00.000Z',
    ); // = 1 Sep 00:00 IST
  });
});
