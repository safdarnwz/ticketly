import { describe, expect, it } from 'vitest';

import { accessibleSeatViolation, salesRuleViolation } from '../domain/sales-rules';

const state = (over: Partial<Parameters<typeof salesRuleViolation>[0]['state']> = {}) => ({
  capacity: 40,
  freeSeats: 10,
  otaSeats: 0,
  categorySeats: { female: 0, senior: 0 },
  ...over,
});
const man = { gender: 'male', category: 'adult' };
const woman = { gender: 'female', category: 'adult' };

describe('salesRuleViolation', () => {
  it('caps OTA sales at the release %, using the platform default when the service has none', () => {
    const base = {
      rules: {},
      platformOtaReleasePct: 50,
      passengers: [man, man],
      hoursToDeparture: 48,
    };
    expect(salesRuleViolation({ ...base, isOta: true, state: state({ otaSeats: 18 }) })).toBeNull();
    expect(salesRuleViolation({ ...base, isOta: true, state: state({ otaSeats: 19 }) })).toMatch(
      /Only 1 seat/,
    );
    expect(
      salesRuleViolation({ ...base, isOta: false, state: state({ otaSeats: 40 }) }),
    ).toBeNull();
    expect(
      salesRuleViolation({
        ...base,
        rules: { otaReleasePct: 100 },
        isOta: true,
        state: state({ otaSeats: 30 }),
      }),
    ).toBeNull();
  });

  it('keeps quota seats for women until release, but women may use them', () => {
    const rules = { categoryQuotas: { female: { seats: 4, releaseHours: 12 } } };
    const base = { rules, platformOtaReleasePct: 100, isOta: false, hoursToDeparture: 48 };
    // 5 free, 4 kept: one man fits, two do not.
    expect(
      salesRuleViolation({ ...base, state: state({ freeSeats: 5 }), passengers: [man] }),
    ).toBeNull();
    expect(
      salesRuleViolation({ ...base, state: state({ freeSeats: 5 }), passengers: [man, man] }),
    ).toMatch(/kept for women/);
    expect(
      salesRuleViolation({ ...base, state: state({ freeSeats: 4 }), passengers: [woman, woman] }),
    ).toBeNull();
    // quota already used by women on board → no longer kept
    expect(
      salesRuleViolation({
        ...base,
        state: state({ freeSeats: 2, categorySeats: { female: 4, senior: 0 } }),
        passengers: [man, man],
      }),
    ).toBeNull();
    // after the release time anyone may book
    expect(
      salesRuleViolation({
        ...base,
        hoursToDeparture: 6,
        state: state({ freeSeats: 2 }),
        passengers: [man, man],
      }),
    ).toBeNull();
  });

  it('supports a percentage senior quota', () => {
    const rules = { categoryQuotas: { senior: { pct: 10, releaseHours: 24 } } }; // 4 of 40
    const r = salesRuleViolation({
      rules,
      platformOtaReleasePct: 100,
      isOta: false,
      hoursToDeparture: 72,
      state: state({ freeSeats: 5 }),
      passengers: [man, man],
    });
    expect(r).toMatch(/senior citizens/);
  });
});

describe('accessibleSeatViolation', () => {
  const seats = [
    { seatNumber: '1', accessible: true },
    { seatNumber: '2', accessible: false },
  ];
  it('keeps accessible seats for disabled passengers until release', () => {
    expect(
      accessibleSeatViolation({
        seats,
        categoryBySeat: { '1': 'adult' },
        hoursToDeparture: 48,
        releaseHours: 24,
      }),
    ).toMatch(/Seat 1/);
    expect(
      accessibleSeatViolation({
        seats,
        categoryBySeat: { '1': 'disabled' },
        hoursToDeparture: 48,
        releaseHours: 24,
      }),
    ).toBeNull();
    expect(
      accessibleSeatViolation({
        seats,
        categoryBySeat: { '1': 'adult' },
        hoursToDeparture: 10,
        releaseHours: 24,
      }),
    ).toBeNull();
    expect(
      accessibleSeatViolation({
        seats,
        categoryBySeat: {},
        hoursToDeparture: 1,
        releaseHours: null,
      }),
    ).toMatch(/Seat 1/);
  });
});
