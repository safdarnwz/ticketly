import { describe, expect, it } from 'vitest';

import { PricingEngine } from '../domain/pricing-engine';
import {
  adjustmentPct,
  applyAdjustment,
  validateBounds,
  validatePeakWindows,
} from '../domain/pricing-rules';

const peak = [
  { startMinute: 17 * 60, endMinute: 22 * 60, pct: 15 },
  { startMinute: 23 * 60, endMinute: 5 * 60, pct: -10 },
];

describe('peak / off-peak by departure time (159/160/231)', () => {
  it('evening peak +15%, overnight off-peak −10%, midday none', () => {
    expect(adjustmentPct({ departureMinuteLocal: 20 * 60, peakWindows: peak, tripPct: null })).toBe(
      15,
    );
    expect(adjustmentPct({ departureMinuteLocal: 2 * 60, peakWindows: peak, tripPct: null })).toBe(
      -10,
    );
    expect(adjustmentPct({ departureMinuteLocal: 12 * 60, peakWindows: peak, tripPct: null })).toBe(
      0,
    );
  });
  it('overlapping windows do not stack — the largest wins; trip % adds; cap −50…+100', () => {
    expect(
      adjustmentPct({
        departureMinuteLocal: 18 * 60,
        peakWindows: [...peak, { startMinute: 18 * 60, endMinute: 19 * 60, pct: 25 }],
        tripPct: null,
      }),
    ).toBe(25);
    expect(adjustmentPct({ departureMinuteLocal: 20 * 60, peakWindows: peak, tripPct: -20 })).toBe(
      -5,
    ); // 355/354 combined
    expect(adjustmentPct({ departureMinuteLocal: 20 * 60, peakWindows: peak, tripPct: 200 })).toBe(
      100,
    );
    expect(applyAdjustment(80000, -10)).toBe(72000);
  });
  it('validation', () => {
    expect(validatePeakWindows([{ startMinute: 60, endMinute: 60, pct: 5 }])).toMatch(/same time/);
    expect(validatePeakWindows([{ startMinute: 60, endMinute: 120, pct: 0 }])).toMatch(/non-zero/);
    expect(validateBounds(90000, 80000)).toMatch(/above the ceiling/);
    expect(validateBounds(null, null)).toBeNull();
  });
});

describe('floor / ceiling in the engine (281/282)', () => {
  const req = {
    currency: 'INR' as never,
    baseFareMinor: 100000,
    occupancyPct: 95,
    daysToDeparture: 0,
    tax: { gstRatePct: 5, interState: false },
    yield: {
      occupancy: [{ atPct: 90, mult: 1.5 }],
      advancePurchase: [],
      minMultiplier: 0.5,
      maxMultiplier: 2,
    },
  };
  it('yield cannot push the fare above the ceiling', () => {
    const b = PricingEngine.price({ ...req, bounds: { ceilingMinor: 120000 } });
    expect(b.total.minor).toBe(126000); // 1200 + 5% GST
  });
  it('without bounds the engine is unchanged', () => {
    expect(PricingEngine.price(req).total.minor).toBe(
      PricingEngine.price({ ...req, bounds: {} }).total.minor,
    );
  });
  it('floor lifts a heavily discounted yield fare', () => {
    const cheap = {
      ...req,
      occupancyPct: 5,
      yield: {
        occupancy: [{ atPct: 0, mult: 0.5 }],
        advancePurchase: [],
        minMultiplier: 0.5,
        maxMultiplier: 2,
      },
    };
    expect(PricingEngine.price({ ...cheap, bounds: { floorMinor: 70000 } }).total.minor).toBe(
      73500,
    );
  });
});
