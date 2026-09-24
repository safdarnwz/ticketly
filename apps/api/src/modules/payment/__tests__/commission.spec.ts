import { describe, expect, it } from 'vitest';

import { computeCommission } from '../domain/commission';

describe('computeCommission', () => {
  it('percent model takes a percentage of the net fare', () => {
    const r = computeCommission({ netFareMinor: 100000, seatCount: 1, config: { model: 'percent', percent: 12 } });
    expect(r.commission.minor).toBe(12000);
    expect(r.operatorShare.minor).toBe(88000);
  });

  it('flat model charges per ticket', () => {
    const r = computeCommission({ netFareMinor: 100000, seatCount: 3, config: { model: 'flat', flatMinor: 2000 } });
    expect(r.commission.minor).toBe(6000);
  });

  it('percent_plus combines both', () => {
    const r = computeCommission({ netFareMinor: 100000, seatCount: 2, config: { model: 'percent_plus', percent: 10, flatMinor: 1000 } });
    expect(r.commission.minor).toBe(12000); // 10000 + 2000
  });

  it('respects the cap', () => {
    const r = computeCommission({ netFareMinor: 100000, seatCount: 1, config: { model: 'percent', percent: 50, capMinor: 20000 } });
    expect(r.commission.minor).toBe(20000);
  });

  it('never exceeds the net fare', () => {
    const r = computeCommission({ netFareMinor: 5000, seatCount: 10, config: { model: 'flat', flatMinor: 2000 } });
    expect(r.commission.minor).toBe(5000); // capped at net, not 20000
    expect(r.operatorShare.minor).toBe(0);
  });

  it('rejects a negative net fare', () => {
    expect(() => computeCommission({ netFareMinor: -1, seatCount: 1, config: { model: 'percent', percent: 10 } })).toThrow(/negative/);
  });

  it('edge: zero net fare yields zero commission', () => {
    const r = computeCommission({ netFareMinor: 0, seatCount: 1, config: { model: 'percent', percent: 10 } });
    expect(r.commission.minor).toBe(0);
  });
});
