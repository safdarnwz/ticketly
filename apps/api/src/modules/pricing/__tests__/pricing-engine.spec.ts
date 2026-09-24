import { describe, expect, it } from 'vitest';

import { PricingEngine, type PriceRequest, type YieldLadder } from '../domain/pricing-engine';

const INR = 'INR' as const;

function baseReq(overrides: Partial<PriceRequest> = {}): PriceRequest {
  return {
    currency: INR,
    baseFareMinor: 100000, // ₹1000.00
    occupancyPct: 0,
    daysToDeparture: 30,
    tax: { gstRatePct: 5, interState: false },
    ...overrides,
  };
}

describe('PricingEngine — base + GST (happy path)', () => {
  it('adds 5% GST split into CGST + SGST intra-state', () => {
    const b = PricingEngine.price(baseReq());
    expect(b.netFare.minor).toBe(100000);
    expect(b.taxTotal.minor).toBe(5000); // 5% of 1000
    expect(b.taxes.map((t) => t.name)).toEqual(['CGST', 'SGST']);
    expect(b.taxes[0].amount.minor + b.taxes[1].amount.minor).toBe(5000);
    expect(b.total.minor).toBe(105000);
  });

  it('uses IGST for inter-state journeys', () => {
    const b = PricingEngine.price(baseReq({ tax: { gstRatePct: 5, interState: true } }));
    expect(b.taxes).toHaveLength(1);
    expect(b.taxes[0].name).toBe('IGST');
    expect(b.taxes[0].amount.minor).toBe(5000);
  });

  it('applies no tax when exempt', () => {
    const b = PricingEngine.price(
      baseReq({ tax: { gstRatePct: 5, interState: false, exempt: true } }),
    );
    expect(b.taxTotal.minor).toBe(0);
    expect(b.total.minor).toBe(100000);
  });
});

describe('PricingEngine — dynamic yield', () => {
  const ladder: YieldLadder = {
    occupancy: [
      { atPct: 50, mult: 1.1 },
      { atPct: 80, mult: 1.25 },
    ],
    advancePurchase: [
      { withinDays: 3, mult: 1.2 },
      { withinDays: 1, mult: 1.4 },
    ],
    maxMultiplier: 2,
    minMultiplier: 0.8,
  };

  it('raises fare at high occupancy', () => {
    const b = PricingEngine.price(baseReq({ occupancyPct: 85, yield: ladder }));
    expect(b.netFare.minor).toBe(125000); // 1.25 × 1000
    expect(b.lines.find((l) => l.kind === 'dynamic')?.amount.minor).toBe(25000);
  });

  it('stacks occupancy × advance-purchase but clamps to maxMultiplier', () => {
    const b = PricingEngine.price(baseReq({ occupancyPct: 85, daysToDeparture: 1, yield: ladder }));
    expect(b.netFare.minor).toBe(175000); // 1.25 × 1.4 = 1.75
  });

  it('respects the max multiplier ceiling', () => {
    const aggressive: YieldLadder = {
      ...ladder,
      occupancy: [{ atPct: 0, mult: 5 }],
      maxMultiplier: 1.5,
    };
    const b = PricingEngine.price(baseReq({ occupancyPct: 10, yield: aggressive }));
    expect(b.netFare.minor).toBe(150000); // capped at 1.5×
  });

  it('leaves fare unchanged with the NO_YIELD ladder', () => {
    const b = PricingEngine.price(baseReq({ occupancyPct: 99 }));
    expect(b.netFare.minor).toBe(100000);
    expect(b.lines.find((l) => l.kind === 'dynamic')).toBeUndefined();
  });
});

describe('PricingEngine — coupons', () => {
  it('applies a percentage coupon before tax', () => {
    const b = PricingEngine.price(
      baseReq({ coupon: { code: 'SAVE10', kind: 'percent', value: 10 } }),
    );
    expect(b.discountTotal.minor).toBe(10000);
    expect(b.netFare.minor).toBe(90000);
    expect(b.taxTotal.minor).toBe(4500); // 5% of 900
    expect(b.total.minor).toBe(94500);
  });

  it('caps a percentage coupon at maxDiscount', () => {
    const b = PricingEngine.price(
      baseReq({ coupon: { code: 'BIG', kind: 'percent', value: 50, maxDiscountMinor: 20000 } }),
    );
    expect(b.discountTotal.minor).toBe(20000);
  });

  it('applies a flat coupon but never below zero fare', () => {
    const b = PricingEngine.price(
      baseReq({ baseFareMinor: 30000, coupon: { code: 'FLAT500', kind: 'flat', value: 50000 } }),
    );
    expect(b.netFare.minor).toBe(0);
    expect(b.total.minor).toBe(0);
  });

  it('does not apply a coupon below its minimum fare', () => {
    const b = PricingEngine.price(
      baseReq({
        baseFareMinor: 20000,
        coupon: { code: 'MIN', kind: 'percent', value: 10, minFareMinor: 50000 },
      }),
    );
    expect(b.discountTotal.minor).toBe(0);
  });

  it('rejects an out-of-range percentage coupon', () => {
    expect(() =>
      PricingEngine.price(baseReq({ coupon: { code: 'BAD', kind: 'percent', value: 150 } })),
    ).toThrow(/0..100/);
  });
});

describe('PricingEngine — priceMany (multi-seat)', () => {
  it('splits a flat coupon across seats with no paisa lost', () => {
    const breakups = PricingEngine.priceMany(
      baseReq({ coupon: { code: 'FLAT100', kind: 'flat', value: 10000 } }),
      3,
    );
    const totalDiscount = breakups.reduce((sum, b) => sum + b.discountTotal.minor, 0);
    expect(totalDiscount).toBe(10000);
    expect(breakups).toHaveLength(3);
  });

  it('applies a percentage coupon identically to each seat', () => {
    const breakups = PricingEngine.priceMany(
      baseReq({ coupon: { code: 'P', kind: 'percent', value: 10 } }),
      2,
    );
    expect(breakups[0].total.minor).toBe(breakups[1].total.minor);
  });
});

describe('PricingEngine — negative & edge', () => {
  it('rejects a negative base fare', () => {
    expect(() => PricingEngine.price(baseReq({ baseFareMinor: -100 }))).toThrow(/negative/);
  });

  it('edge: zero base fare produces zero total and no tax', () => {
    const b = PricingEngine.price(baseReq({ baseFareMinor: 0 }));
    expect(b.total.minor).toBe(0);
    expect(b.taxes).toHaveLength(0);
  });

  it('edge: GST split on an odd amount still reconciles exactly', () => {
    const b = PricingEngine.price(baseReq({ baseFareMinor: 99900 }));
    expect(b.taxes[0].amount.minor + b.taxes[1].amount.minor).toBe(b.taxTotal.minor);
    expect(b.netFare.plus(b.taxTotal).minor).toBe(b.total.minor);
  });

  it('edge: breakup identity total == net + taxes always holds', () => {
    const b = PricingEngine.price(
      baseReq({
        occupancyPct: 90,
        daysToDeparture: 2,
        coupon: { code: 'X', kind: 'percent', value: 15 },
        yield: {
          occupancy: [{ atPct: 80, mult: 1.3 }],
          advancePurchase: [{ withinDays: 3, mult: 1.1 }],
          maxMultiplier: 2,
          minMultiplier: 0.5,
        },
      }),
    );
    expect(b.total.minor).toBe(b.netFare.plus(b.taxTotal).minor);
  });
});
