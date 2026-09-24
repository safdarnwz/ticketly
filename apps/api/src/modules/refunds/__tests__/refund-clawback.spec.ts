import { describe, it, expect } from 'vitest';

import { commissionClawbackMinor, splitRefundClawback } from '../domain/refund-clawback';

/** captured = commission + commission GST + operator share (fare + fare GST pass through to the operator). */
describe('splitRefundClawback', () => {
  const captured = { commissionMinor: 1000, commissionGstMinor: 180, operatorShareMinor: 8820 }; // total 10000
  const foot = (r: ReturnType<typeof splitRefundClawback>) =>
    r.commissionClawbackMinor + r.commissionGstClawbackMinor + r.operatorClawbackMinor;

  it('happy: a full refund reverses every leg exactly', () => {
    const r = splitRefundClawback(captured, 10000);
    expect(r).toEqual({
      commissionClawbackMinor: 1000,
      commissionGstClawbackMinor: 180,
      operatorClawbackMinor: 8820,
    });
  });

  it('happy: a partial refund claws back each leg in proportion', () => {
    const r = splitRefundClawback(captured, 5000); // 50%
    expect(r.commissionClawbackMinor).toBe(500);
    expect(r.commissionGstClawbackMinor).toBe(90);
    expect(r.operatorClawbackMinor).toBe(4410);
    expect(foot(r)).toBe(5000);
  });

  it('edge: rounding is absorbed by the operator leg — the legs always foot to the refund', () => {
    const odd = { commissionMinor: 333, commissionGstMinor: 60, operatorShareMinor: 607 }; // total 1000
    for (const refund of [1, 7, 333, 777, 999, 1000])
      expect(foot(splitRefundClawback(odd, refund))).toBe(refund);
  });

  it('edge: zero refund (non-refundable cancellation) yields zero legs', () => {
    expect(foot(splitRefundClawback(captured, 0))).toBe(0);
  });

  it('edge: nothing was ever captured → zero legs', () => {
    expect(
      splitRefundClawback({ commissionMinor: 0, commissionGstMinor: 0, operatorShareMinor: 0 }, 0),
    ).toEqual({
      commissionClawbackMinor: 0,
      commissionGstClawbackMinor: 0,
      operatorClawbackMinor: 0,
    });
  });

  it('negative: a refund larger than the capture is rejected', () => {
    expect(() => splitRefundClawback(captured, 10001)).toThrow(/exceeds the captured amount/);
  });

  it('negative: a negative refund is rejected', () => {
    expect(() => splitRefundClawback(captured, -1)).toThrow(/cannot be negative/);
  });

  it('property: platform legs never exceed the refund; operator leg never negative', () => {
    const heavy = { commissionMinor: 9000, commissionGstMinor: 1620, operatorShareMinor: 380 };
    for (const refund of [1, 50, 100, 5000, 11000]) {
      const r = splitRefundClawback(heavy, refund);
      expect(r.commissionClawbackMinor + r.commissionGstClawbackMinor).toBeLessThanOrEqual(refund);
      expect(r.operatorClawbackMinor).toBeGreaterThanOrEqual(0);
      expect(foot(r)).toBe(refund);
    }
  });
});

describe('commissionClawbackMinor (B2B sale refund)', () => {
  it('full refund reverses all commission', () => {
    expect(
      commissionClawbackMinor({
        commissionCreditedMinor: 5000,
        refundMinor: 105000,
        paidMinor: 105000,
      }),
    ).toBe(5000);
  });
  it('partial refund reverses the same proportion', () => {
    expect(
      commissionClawbackMinor({
        commissionCreditedMinor: 5000,
        refundMinor: 52500,
        paidMinor: 105000,
      }),
    ).toBe(2500);
  });
  it('never exceeds what was credited, never negative', () => {
    expect(
      commissionClawbackMinor({
        commissionCreditedMinor: 5000,
        refundMinor: 200000,
        paidMinor: 105000,
      }),
    ).toBe(5000);
    expect(
      commissionClawbackMinor({ commissionCreditedMinor: 0, refundMinor: 1000, paidMinor: 1000 }),
    ).toBe(0);
    expect(
      commissionClawbackMinor({ commissionCreditedMinor: 5000, refundMinor: 0, paidMinor: 1000 }),
    ).toBe(0);
  });
});
