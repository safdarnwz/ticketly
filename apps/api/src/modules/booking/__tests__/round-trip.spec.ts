import { describe, expect, it } from 'vitest';

import { applyRoundTripDiscount, roundTripProblem, type OnwardLeg } from '../domain/round-trip';

const onward: OnwardLeg = {
  status: 'confirmed',
  customerId: 'u1',
  contactPhone: '+91 98765 43210',
  fromCityId: 'delhi',
  toCityId: 'jaipur',
  departsAt: new Date('2026-10-01T16:00:00Z'),
};
const ret = {
  fromCityId: 'jaipur',
  toCityId: 'delhi',
  departsAt: new Date('2026-10-05T16:00:00Z'),
};

describe('round trip — which return qualifies (#283)', () => {
  it('the same customer going back the other way, later', () => {
    expect(roundTripProblem(onward, ret, { userId: 'u1' })).toBeNull();
  });

  it('the same booking mobile, written any way, is enough', () => {
    expect(roundTripProblem(onward, ret, { userId: null, contactPhone: '9876543210' })).toBeNull();
  });

  it('someone else — or no onward booking — is told it was not found', () => {
    expect(roundTripProblem(onward, ret, { userId: 'u2', contactPhone: '9000000000' })).toMatch(
      /not found/,
    );
    expect(roundTripProblem(null, ret, { userId: 'u1' })).toMatch(/not found/);
    expect(roundTripProblem({ ...onward, customerId: null }, ret, { userId: null })).toMatch(
      /not found/,
    );
  });

  it('an onward booking that is not confirmed (held, cancelled) does not count', () => {
    expect(roundTripProblem({ ...onward, status: 'cancelled' }, ret, { userId: 'u1' })).toMatch(
      /not confirmed/,
    );
    expect(roundTripProblem({ ...onward, status: 'held' }, ret, { userId: 'u1' })).toMatch(
      /not confirmed/,
    );
  });

  it('must go back the way it came', () => {
    expect(roundTripProblem(onward, { ...ret, toCityId: 'agra' }, { userId: 'u1' })).toMatch(
      /back the way/,
    );
    expect(
      roundTripProblem(
        onward,
        { ...ret, fromCityId: 'delhi', toCityId: 'jaipur' },
        { userId: 'u1' },
      ),
    ).toMatch(/back the way/);
  });

  it('must leave after the onward bus', () => {
    expect(
      roundTripProblem(onward, { ...ret, departsAt: onward.departsAt }, { userId: 'u1' }),
    ).toMatch(/after the onward/);
  });
});

describe('round trip — the discount', () => {
  const priced = {
    fareBySeat: new Map([
      ['1', 105000],
      ['2', 52500],
    ]),
    totals: { baseMinor: 150000, discountMinor: 0, taxMinor: 7500, totalMinor: 157500 },
  };

  it('takes the % off every seat and keeps base − discount + tax = total', () => {
    const r = applyRoundTripDiscount(priced, 10);
    expect(r.fareBySeat.get('1')).toBe(94500);
    expect(r.fareBySeat.get('2')).toBe(47250);
    expect(r.roundTripMinor).toBe(15750);
    expect(r.totals.totalMinor).toBe(141750);
    expect(r.totals.taxMinor).toBe(6750);
    expect(r.totals.baseMinor - r.totals.discountMinor + r.totals.taxMinor).toBe(
      r.totals.totalMinor,
    );
  });

  it('0% changes nothing; more than 50% is held at 50%', () => {
    expect(applyRoundTripDiscount(priced, 0).totals).toEqual(priced.totals);
    expect(applyRoundTripDiscount(priced, 90).roundTripMinor).toBe(78750);
  });
});
