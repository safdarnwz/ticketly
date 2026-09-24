import { describe, expect, it } from 'vitest';

import {
  HoldValidationError,
  equalSplit,
  resolveSeatFares,
  validateHoldSelection,
} from '../domain/hold-validation';

const pax = (...seats: string[]) => seats.map((s, i) => ({ seatNumber: s, fullName: `P${i}` }));

describe('validateHoldSelection', () => {
  it('happy: one passenger per selected seat', () => {
    expect(() => validateHoldSelection(['1A', '1B'], pax('1A', '1B'), 2)).not.toThrow();
  });
  it('surrounding spaces are ignored, but labels are case-exact', () => {
    expect(() => validateHoldSelection([' 1A', '1B'], pax('1A', '1B '), 2)).not.toThrow();
    expect(() => validateHoldSelection(['U1'], pax('u1'), 1)).toThrow(/unknown seat/);
  });
  it('negative: duplicate seat (even with different spacing)', () => {
    expect(() => validateHoldSelection(['1A', ' 1A'], pax('1A', '1A'), 2)).toThrow(
      /more than once/,
    );
  });
  it('negative: seat count differs from the quote', () => {
    expect(() => validateHoldSelection(['1A'], pax('1A'), 2)).toThrow(/Quote is for 2/);
  });
  it('negative: missing passenger, extra passenger, two passengers on one seat', () => {
    expect(() => validateHoldSelection(['1A', '1B'], pax('1A'), 2)).toThrow(
      /one passenger per seat/,
    );
    expect(() => validateHoldSelection(['1A'], pax('1A', '1B'), 1)).toThrow(
      /one passenger per seat/,
    );
    expect(() => validateHoldSelection(['1A', '1B'], pax('1A', '1A'), 2)).toThrow(/Two passengers/);
  });
  it('negative: passenger on an unselected seat; blank name; empty selection', () => {
    expect(() => validateHoldSelection(['1A'], pax('9Z'), 1)).toThrow(/unknown seat/);
    expect(() => validateHoldSelection(['1A'], [{ seatNumber: '1A', fullName: '  ' }], 1)).toThrow(
      /name is required/,
    );
    expect(() => validateHoldSelection([], [], 0)).toThrow(HoldValidationError);
  });
});

describe('resolveSeatFares', () => {
  const quote = {
    seatFares: [
      { seatNumber: '1A', totalMinor: 90000 },
      { seatNumber: '5C', totalMinor: 75000 },
    ],
    totalMinor: 165000,
  };
  it('uses the real per-seat fares from the quote (not an equal split)', () => {
    const r = resolveSeatFares(quote, [' 5C', '1A']);
    expect(r.kind).toBe('priced');
    if (r.kind === 'priced') {
      expect(r.fareBySeat.get('1A')).toBe(90000);
      expect(r.fareBySeat.get('5C')).toBe(75000);
    }
  });
  it('SECURITY: a quote for cheap seats cannot hold different (premium) seats', () => {
    expect(() => resolveSeatFares(quote, ['1A', '1B'])).toThrow(/please refresh the price/);
  });
  it('negative: fares that do not add up to the total are refused', () => {
    expect(() => resolveSeatFares({ ...quote, totalMinor: 1 }, ['1A', '5C'])).toThrow(
      /inconsistent/,
    );
  });
  it('a count-only quote asks the caller to re-price for the chosen seats', () => {
    expect(resolveSeatFares({ seatFares: [], totalMinor: 100 }, ['1A'])).toEqual({
      kind: 'needs_seat_quote',
    });
  });
});

describe('equalSplit', () => {
  it('foots exactly, remainder on the first seat', () => {
    expect(equalSplit(100001, 3)).toEqual([33335, 33333, 33333]);
    expect(equalSplit(100001, 3).reduce((a, b) => a + b, 0)).toBe(100001);
    expect(equalSplit(500, 0)).toEqual([]);
  });
});
