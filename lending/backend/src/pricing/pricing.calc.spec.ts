import { computeOffer, maxPrincipalForCapacity, PricingTerms } from './pricing.calc';

const t = (o: Partial<PricingTerms>): PricingTerms => ({
  interestUnit: 'PER_ANNUM', interestRatePercent: 18, feeType: 'PERCENT', feeValue: 1, gstPercent: 0, tenureDays: 30, ...o,
});

describe('computeOffer', () => {
  it('matches the business plan 18% p.a. / 1% fee example (without GST)', () => {
    const o = computeOffer(t({}), 2_000_000);
    expect(o.processingFeePaise).toBe(20_000); // ₹200
    expect(o.netDisbursalPaise).toBe(1_980_000); // ₹19,800
    expect(o.interestPaise).toBe(29_589); // ₹295.89
    expect(o.totalRepayablePaise).toBe(2_029_589); // ₹20,295.89
    expect(o.aprBps).toBe(3047); // ~30.47%
    expect(o.effectiveAnnualBps).toBe(3512); // ~35.12%
  });

  it('supports interest per day: the plan’s 1%/day + 10% fee example', () => {
    const o = computeOffer(t({ interestUnit: 'PER_DAY', interestRatePercent: 1, feeValue: 10 }), 2_000_000);
    expect(o.netDisbursalPaise).toBe(1_800_000);
    expect(o.interestPaise).toBe(600_000);
    expect(o.totalRepayablePaise).toBe(2_600_000);
    expect(o.dailyInterestPercent).toBe(1);
    expect(o.annualInterestPercent).toBe(365);
    expect(o.aprBps).toBe(54_074); // ~540.74%
  });

  it('supports a flat rupee processing fee and GST', () => {
    const o = computeOffer(t({ feeType: 'FLAT', feeValue: 499, gstPercent: 18 }), 2_000_000);
    expect(o.processingFeePaise).toBe(49_900);
    expect(o.gstOnFeePaise).toBe(8_982);
    expect(o.netDisbursalPaise).toBe(2_000_000 - 49_900 - 8_982);
  });

  it('allows zero interest and zero fee offers', () => {
    const o = computeOffer(t({ interestRatePercent: 0, feeValue: 0 }), 1_000_000);
    expect(o.totalCostPaise).toBe(0);
    expect(o.aprBps).toBe(0);
  });

  it('rejects fees larger than the loan and non-integer principal', () => {
    expect(() => computeOffer(t({ feeType: 'FLAT', feeValue: 20_000 }), 1_000_000)).toThrow();
    expect(() => computeOffer(t({}), 10.5)).toThrow();
  });
});

describe('maxPrincipalForCapacity', () => {
  it('keeps principal + interest within the capacity and rounds to ₹500', () => {
    const terms = t({ gstPercent: 18 });
    const p = maxPrincipalForCapacity(terms, 1_500_000);
    expect(p % 50_000).toBe(0);
    expect(computeOffer(terms, p).totalRepayablePaise).toBeLessThanOrEqual(1_500_000);
  });
});
