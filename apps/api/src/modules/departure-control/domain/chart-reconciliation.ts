import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

/**
 * ============================================================================
 *  Departure control — trip chart reconciliation
 * ============================================================================
 *
 * At departure, the conductor "charts" the trip: who actually boarded, who was a
 * no-show, and (for any onboard/spot sales the operator allows) the cash
 * collected. This pure engine reconciles the expected picture against the actual
 * one so the trip can be closed out with a clear cash and seat position.
 *
 *   expected boarded  = confirmed tickets whose segment covers the departure point
 *   actual boarded    = tickets scanned boarded (Part 9)
 *   no-shows          = expected − boarded
 *   vacant seats      = capacity − occupied  (available for spot resale)
 *
 * The cash reconciliation compares declared cash against expected onboard-sale
 * revenue; a mismatch is surfaced (not silently accepted) so shortages are
 * caught at closeout, not in a month-end audit.
 */

export interface ChartInput {
  totalSeats: number;
  confirmedSeats: number;   // seats sold (occupying the departure leg)
  boardedSeats: number;     // scanned boarded
  spotSalesCount: number;   // onboard/spot sales at departure
  spotSalesCashMinor: number; // cash the conductor declares from spot sales
  expectedSpotFareMinor: number; // fare that SHOULD have been collected per spot sale
}

export interface ChartResult {
  noShowSeats: number;
  vacantSeats: number;
  boardingRatePct: number;
  cashDeclaredMinor: number;
  cashExpectedMinor: number;
  cashVarianceMinor: number; // + surplus, − shortage
  reconciled: boolean;       // true when cash matches expectation
}

export function reconcileChart(input: ChartInput, currency: CurrencyCode = 'INR'): ChartResult {
  if (input.totalSeats < 0 || input.confirmedSeats < 0 || input.boardedSeats < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Seat counts cannot be negative');
  }
  if (input.confirmedSeats > input.totalSeats) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Confirmed seats exceed capacity');
  }
  if (input.boardedSeats > input.confirmedSeats + input.spotSalesCount) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Boarded exceeds confirmed + spot sales');
  }

  const noShowSeats = Math.max(0, input.confirmedSeats - Math.min(input.boardedSeats, input.confirmedSeats));
  const vacantSeats = input.totalSeats - input.confirmedSeats - input.spotSalesCount;

  const cashExpected = Money.of(input.expectedSpotFareMinor * input.spotSalesCount, currency);
  const cashDeclared = Money.of(input.spotSalesCashMinor, currency);
  const variance = cashDeclared.minus(cashExpected);

  return {
    noShowSeats,
    vacantSeats: Math.max(0, vacantSeats),
    boardingRatePct: input.confirmedSeats > 0
      ? Math.round((Math.min(input.boardedSeats, input.confirmedSeats) / input.confirmedSeats) * 100)
      : 0,
    cashDeclaredMinor: cashDeclared.minor,
    cashExpectedMinor: cashExpected.minor,
    cashVarianceMinor: variance.minor,
    reconciled: variance.isZero(),
  };
}
