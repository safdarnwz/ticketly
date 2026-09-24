import { describe, expect, it } from 'vitest';

import { reconcileChart } from '../domain/chart-reconciliation';

describe('reconcileChart', () => {
  it('computes no-shows, vacant seats and boarding rate', () => {
    const r = reconcileChart({ totalSeats: 40, confirmedSeats: 30, boardedSeats: 27, spotSalesCount: 2, spotSalesCashMinor: 4000, expectedSpotFareMinor: 2000 });
    expect(r.noShowSeats).toBe(3);
    expect(r.vacantSeats).toBe(8); // 40 - 30 - 2
    expect(r.boardingRatePct).toBe(90);
    expect(r.reconciled).toBe(true); // 2 × 2000 = 4000 declared
  });

  it('flags a cash shortage', () => {
    const r = reconcileChart({ totalSeats: 40, confirmedSeats: 10, boardedSeats: 10, spotSalesCount: 3, spotSalesCashMinor: 5000, expectedSpotFareMinor: 2000 });
    expect(r.cashExpectedMinor).toBe(6000);
    expect(r.cashVarianceMinor).toBe(-1000); // shortage
    expect(r.reconciled).toBe(false);
  });

  it('flags a cash surplus', () => {
    const r = reconcileChart({ totalSeats: 40, confirmedSeats: 10, boardedSeats: 10, spotSalesCount: 1, spotSalesCashMinor: 2500, expectedSpotFareMinor: 2000 });
    expect(r.cashVarianceMinor).toBe(500);
  });

  it('edge: full boarding, no spot sales', () => {
    const r = reconcileChart({ totalSeats: 40, confirmedSeats: 40, boardedSeats: 40, spotSalesCount: 0, spotSalesCashMinor: 0, expectedSpotFareMinor: 0 });
    expect(r.noShowSeats).toBe(0);
    expect(r.vacantSeats).toBe(0);
    expect(r.boardingRatePct).toBe(100);
    expect(r.reconciled).toBe(true);
  });

  it('edge: empty trip has 0% boarding, not a divide-by-zero', () => {
    const r = reconcileChart({ totalSeats: 40, confirmedSeats: 0, boardedSeats: 0, spotSalesCount: 0, spotSalesCashMinor: 0, expectedSpotFareMinor: 0 });
    expect(r.boardingRatePct).toBe(0);
    expect(r.vacantSeats).toBe(40);
  });

  it('rejects confirmed exceeding capacity', () => {
    expect(() => reconcileChart({ totalSeats: 10, confirmedSeats: 12, boardedSeats: 0, spotSalesCount: 0, spotSalesCashMinor: 0, expectedSpotFareMinor: 0 })).toThrow(/exceed capacity/);
  });

  it('rejects boarded exceeding confirmed + spot', () => {
    expect(() => reconcileChart({ totalSeats: 40, confirmedSeats: 10, boardedSeats: 15, spotSalesCount: 2, spotSalesCashMinor: 0, expectedSpotFareMinor: 0 })).toThrow(/Boarded exceeds/);
  });
});
