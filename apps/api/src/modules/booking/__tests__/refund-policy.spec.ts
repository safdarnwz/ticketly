import { describe, expect, it } from 'vitest';

import { computeRefund, DEFAULT_REFUND_POLICY, type RefundPolicy } from '../domain/refund-policy';

const DEP = new Date('2026-03-15T20:30:00Z');
const paid = 100000; // ₹1000

function at(hoursBefore: number): Date {
  return new Date(DEP.getTime() - hoursBefore * 3_600_000);
}

describe('computeRefund — tiers (happy path)', () => {
  it('gives 90% more than 24h before', () => {
    const r = computeRefund(paid, DEP, at(30));
    expect(r.refundPct).toBe(90);
    expect(r.refund.minor).toBe(90000);
    expect(r.refundable).toBe(true);
  });

  it('gives 75% between 6h and 24h', () => {
    expect(computeRefund(paid, DEP, at(10)).refund.minor).toBe(75000);
  });

  it('gives 50% between 2h and 6h', () => {
    expect(computeRefund(paid, DEP, at(3)).refund.minor).toBe(50000);
  });

  it('gives 0% under 2h', () => {
    const r = computeRefund(paid, DEP, at(1));
    expect(r.refundPct).toBe(0);
    expect(r.refund.minor).toBe(0);
    expect(r.refundable).toBe(false);
  });

  it('gives 0% after departure', () => {
    expect(computeRefund(paid, DEP, new Date(DEP.getTime() + 3_600_000)).refund.minor).toBe(0);
  });
});

describe('computeRefund — flat fee & cutoff', () => {
  it('deducts a flat fee from the refund', () => {
    const policy: RefundPolicy = { tiers: DEFAULT_REFUND_POLICY.tiers, flatFeeMinor: 5000 };
    const r = computeRefund(paid, DEP, at(30), policy);
    expect(r.fee.minor).toBe(5000);
    expect(r.refund.minor).toBe(85000); // 90000 - 5000
  });

  it('never lets the fee push the refund below zero', () => {
    const policy: RefundPolicy = {
      tiers: [{ minHoursBeforeDeparture: 0, refundPct: 5 }],
      flatFeeMinor: 100000,
    };
    const r = computeRefund(paid, DEP, at(30), policy);
    expect(r.refund.minor).toBe(0);
  });

  it('forbids cancellation within the cutoff window', () => {
    const policy: RefundPolicy = { tiers: DEFAULT_REFUND_POLICY.tiers, cutoffHours: 4 };
    const r = computeRefund(paid, DEP, at(2), policy);
    expect(r.refundable).toBe(false);
    expect(r.reason).toMatch(/not permitted within 4h/);
  });
});

describe('computeRefund — negative & edge', () => {
  it('rejects a negative paid amount', () => {
    expect(() => computeRefund(-1, DEP, at(30))).toThrow(/negative/);
  });

  it('edge: exactly at a tier boundary takes the higher tier', () => {
    // exactly 24h → 90% tier (>= is inclusive)
    expect(computeRefund(paid, DEP, at(24)).refundPct).toBe(90);
    // exactly 6h → 75%
    expect(computeRefund(paid, DEP, at(6)).refundPct).toBe(75);
  });

  it('edge: zero paid yields zero refund without error', () => {
    const r = computeRefund(0, DEP, at(30));
    expect(r.refund.minor).toBe(0);
    expect(r.refundable).toBe(false);
  });

  it('edge: refund percentage rounds to the paisa', () => {
    // 75% of 999 = 749.25 → 74925 paise
    const r = computeRefund(99900, DEP, at(10));
    expect(r.refund.minor).toBe(74925);
  });
});
