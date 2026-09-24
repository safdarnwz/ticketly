import { describe, expect, it } from 'vitest';

import { quoteReschedule } from '../domain/reschedule-policy';

const DEP = new Date('2026-03-15T20:30:00Z');
const at = (h: number) => new Date(DEP.getTime() - h * 3_600_000);

describe('quoteReschedule — happy path', () => {
  it('charges fare difference + fee for a pricier new trip', () => {
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 130000,
      originalDepartureAt: DEP,
      now: at(30),
      timesRescheduled: 0,
    });
    expect(q.allowed).toBe(true);
    expect(q.fareDifferenceMinor).toBe(30000);
    expect(q.feeMinor).toBe(5000); // >24h tier
    expect(q.amountDueMinor).toBe(35000);
    expect(q.refundDueMinor).toBe(0);
  });

  it('charges only the fee when new fare equals original', () => {
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 100000,
      originalDepartureAt: DEP,
      now: at(10),
      timesRescheduled: 0,
    });
    expect(q.feeMinor).toBe(10000); // 6-24h tier
    expect(q.amountDueMinor).toBe(10000);
  });

  it('refunds when new trip is cheaper by more than the fee', () => {
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 70000,
      originalDepartureAt: DEP,
      now: at(30),
      timesRescheduled: 0,
    });
    // diff -30000, fee 5000 → refund 25000
    expect(q.amountDueMinor).toBe(0);
    expect(q.refundDueMinor).toBe(25000);
  });

  it('nets fee against a small fare reduction (no refund, reduced amount due)', () => {
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 97000,
      originalDepartureAt: DEP,
      now: at(30),
      timesRescheduled: 0,
    });
    // diff -3000 + fee 5000 = net +2000 payable; no refund.
    expect(q.refundDueMinor).toBe(0);
    expect(q.amountDueMinor).toBe(2000);
  });
});

describe('quoteReschedule — denials & edges', () => {
  it('denies after max reschedules', () => {
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 100000,
      originalDepartureAt: DEP,
      now: at(30),
      timesRescheduled: 2,
    });
    expect(q.allowed).toBe(false);
    expect(q.reason).toMatch(/already been rescheduled/);
  });

  it('denies within the cutoff window', () => {
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 100000,
      originalDepartureAt: DEP,
      now: at(1),
      timesRescheduled: 0,
    });
    expect(q.allowed).toBe(false);
    expect(q.reason).toMatch(/not permitted within 2h/);
  });

  it('edge: exactly at a tier boundary takes the higher (earlier) tier fee', () => {
    expect(
      quoteReschedule({
        originalFareMinor: 100000,
        newFareMinor: 100000,
        originalDepartureAt: DEP,
        now: at(24),
        timesRescheduled: 0,
      }).feeMinor,
    ).toBe(5000);
    expect(
      quoteReschedule({
        originalFareMinor: 100000,
        newFareMinor: 100000,
        originalDepartureAt: DEP,
        now: at(6),
        timesRescheduled: 0,
      }).feeMinor,
    ).toBe(10000);
  });

  it('edge: between cutoff and lowest tier applies the highest fee', () => {
    // 3h before: above cutoff (2h), below 6h → 2-6h tier fee 15000
    const q = quoteReschedule({
      originalFareMinor: 100000,
      newFareMinor: 100000,
      originalDepartureAt: DEP,
      now: at(3),
      timesRescheduled: 0,
    });
    expect(q.feeMinor).toBe(15000);
  });

  it('rejects negative fares', () => {
    expect(() =>
      quoteReschedule({
        originalFareMinor: -1,
        newFareMinor: 100,
        originalDepartureAt: DEP,
        now: at(30),
        timesRescheduled: 0,
      }),
    ).toThrow(/negative/);
  });
});
