import { computeOffer, maxPrincipalForCapacity } from './pricing.calc';

describe('computeOffer', () => {
  it('matches the business plan 18% p.a. / 1% fee example (without GST)', () => {
    const o = computeOffer({ annualInterestBps: 1800, processingFeeBps: 100, gstOnFeeBps: 0, tenureDays: 30 }, 2_000_000);
    expect(o.processingFeePaise).toBe(20_000); // ₹200
    expect(o.netDisbursalPaise).toBe(1_980_000); // ₹19,800
    expect(o.interestPaise).toBe(29_589); // ₹295.89
    expect(o.totalRepayablePaise).toBe(2_029_589); // ₹20,295.89
    expect(o.aprBps).toBe(3047); // ~30.47%
    expect(o.effectiveAnnualBps).toBe(3512); // ~35.12%
  });

  it('matches the plan 1%/day + 10% fee example and shows how expensive it is', () => {
    const o = computeOffer({ annualInterestBps: 36_500, processingFeeBps: 1000, gstOnFeeBps: 0, tenureDays: 30 }, 2_000_000);
    expect(o.netDisbursalPaise).toBe(1_800_000);
    expect(o.totalRepayablePaise).toBe(2_600_000);
    expect(o.aprBps).toBe(54_074); // ~540.74%
  });

  it('includes GST on the processing fee in the deduction and the APR', () => {
    const o = computeOffer({ annualInterestBps: 1800, processingFeeBps: 100, gstOnFeeBps: 1800, tenureDays: 30 }, 2_000_000);
    expect(o.gstOnFeePaise).toBe(3_600);
    expect(o.netDisbursalPaise).toBe(1_976_400);
    expect(o.aprBps).toBeGreaterThan(3047);
  });

  it('rejects non-integer principal', () => {
    expect(() => computeOffer({ annualInterestBps: 1800, processingFeeBps: 100, gstOnFeeBps: 0, tenureDays: 30 }, 10.5)).toThrow();
  });
});

describe('maxPrincipalForCapacity', () => {
  it('keeps principal + interest within the capacity and rounds to ₹500', () => {
    const terms = { annualInterestBps: 1800, processingFeeBps: 100, gstOnFeeBps: 1800, tenureDays: 30 };
    const p = maxPrincipalForCapacity(terms, 1_500_000);
    expect(p % 50_000).toBe(0);
    expect(computeOffer(terms, p).totalRepayablePaise).toBeLessThanOrEqual(1_500_000);
  });
});
