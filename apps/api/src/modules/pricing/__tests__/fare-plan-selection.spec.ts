import { describe, expect, it } from 'vitest';

import { appliesOn, isoWeekday, selectFarePlan, validatePlanWindow, type FarePlanCandidate } from '../domain/fare-plan-selection';

const regular: FarePlanCandidate = { id: 'regular', effectiveFrom: '2026-01-01', effectiveTo: null, weekdays: null };
const weekend: FarePlanCandidate = { id: 'weekend', effectiveFrom: '2026-01-01', effectiveTo: null, weekdays: [6, 7] };
const diwali: FarePlanCandidate = { id: 'diwali', effectiveFrom: '2026-10-20', effectiveTo: '2026-11-05', weekdays: null };
const nye: FarePlanCandidate = { id: 'nye', effectiveFrom: '2026-12-31', effectiveTo: '2026-12-31', weekdays: null };
const all = [regular, weekend, diwali, nye];

describe('selectFarePlan', () => {
  it('BUG FIX: a season created later does NOT apply outside its own dates', () => {
    expect(selectFarePlan(all, '2026-09-23')!.id).toBe('regular'); // Wednesday in September
  });
  it('weekend plan on Sat/Sun only', () => {
    expect(isoWeekday('2026-09-26')).toBe(6);
    expect(selectFarePlan(all, '2026-09-26')!.id).toBe('weekend');
    expect(selectFarePlan(all, '2026-09-28')!.id).toBe('regular'); // Monday
  });
  it('season beats weekend inside the season; special day beats everything', () => {
    expect(selectFarePlan(all, '2026-10-24')!.id).toBe('diwali'); // a Saturday in the season
    expect(selectFarePlan(all, '2026-12-31')!.id).toBe('nye');
  });
  it('range bounds are inclusive; before any plan starts → null', () => {
    expect(appliesOn(diwali, '2026-10-20')).toBe(true);
    expect(appliesOn(diwali, '2026-11-05')).toBe(true);
    expect(appliesOn(diwali, '2026-11-06')).toBe(false);
    expect(selectFarePlan(all, '2025-12-31')).toBeNull();
  });
  it('tie on specificity → the most recently started plan', () => {
    const newer: FarePlanCandidate = { id: 'regular-2', effectiveFrom: '2026-06-01', effectiveTo: null, weekdays: null };
    expect(selectFarePlan([regular, newer], '2026-07-01')!.id).toBe('regular-2');
  });
});

describe('validatePlanWindow', () => {
  it('rejects inverted ranges, bad or duplicate weekdays', () => {
    expect(validatePlanWindow({ effectiveFrom: '2026-11-05', effectiveTo: '2026-10-20' })).toMatch(/end date/);
    expect(validatePlanWindow({ weekdays: [0] })).toMatch(/1 \(Mon\)/);
    expect(validatePlanWindow({ weekdays: [6, 6] })).toMatch(/twice/);
    expect(validatePlanWindow({ effectiveFrom: '2026-10-20', effectiveTo: '2026-10-20', weekdays: [6, 7] })).toBeNull();
  });
});
