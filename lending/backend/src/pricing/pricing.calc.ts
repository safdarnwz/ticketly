/**
 * Pure pricing maths. Amounts in paise. Everything the owner can configure is an input here:
 * interest per day or per annum, percent or flat processing fee, GST, tenure.
 */
export type InterestUnit = 'PER_DAY' | 'PER_ANNUM';
export type FeeType = 'PERCENT' | 'FLAT';

export interface PricingTerms {
  interestUnit: InterestUnit;
  /** e.g. 1 with PER_DAY = 1% per day; 18 with PER_ANNUM = 18% a year. */
  interestRatePercent: number;
  feeType: FeeType;
  /** Percent of the loan (PERCENT) or rupees (FLAT). */
  feeValue: number;
  gstPercent: number;
  tenureDays: number;
}

export interface LoanOffer {
  principalPaise: number;
  processingFeePaise: number;
  gstOnFeePaise: number;
  netDisbursalPaise: number;
  interestPaise: number;
  totalRepayablePaise: number;
  totalCostPaise: number;
  tenureDays: number;
  dailyInterestPercent: number;
  annualInterestPercent: number;
  /** APR: annualised cost on the amount actually received (RBI KFS method, bullet loan). */
  aprBps: number;
  /** Compounded (effective) annual cost, shown for transparency. */
  effectiveAnnualBps: number;
}

export const dailyRate = (t: Pick<PricingTerms, 'interestUnit' | 'interestRatePercent'>) =>
  t.interestUnit === 'PER_DAY' ? t.interestRatePercent / 100 : t.interestRatePercent / 100 / 365;

export function feePaise(t: Pick<PricingTerms, 'feeType' | 'feeValue'>, principalPaise: number) {
  return Math.round(t.feeType === 'PERCENT' ? (principalPaise * t.feeValue) / 100 : t.feeValue * 100);
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function computeOffer(terms: PricingTerms, principalPaise: number): LoanOffer {
  if (!Number.isInteger(principalPaise) || principalPaise <= 0) throw new Error('principal must be positive paise');
  const fee = feePaise(terms, principalPaise);
  const gst = Math.round((fee * terms.gstPercent) / 100);
  const net = principalPaise - fee - gst;
  if (net <= 0) throw new Error('fees are larger than the loan');
  const daily = dailyRate(terms);
  // Simple interest on the sanctioned principal for the tenure.
  const interest = Math.round(principalPaise * daily * terms.tenureDays);
  const total = principalPaise + interest;
  const cost = total - net;
  const periodRate = cost / net;
  return {
    principalPaise,
    processingFeePaise: fee,
    gstOnFeePaise: gst,
    netDisbursalPaise: net,
    interestPaise: interest,
    totalRepayablePaise: total,
    totalCostPaise: cost,
    tenureDays: terms.tenureDays,
    dailyInterestPercent: round6(daily * 100),
    annualInterestPercent: round6(daily * 365 * 100),
    aprBps: Math.round(periodRate * (365 / terms.tenureDays) * 10_000),
    effectiveAnnualBps: Math.round((Math.pow(1 + periodRate, 365 / terms.tenureDays) - 1) * 10_000),
  };
}

/** Largest principal (rounded down to ₹500) whose total repayment fits within `capacityPaise`. */
export function maxPrincipalForCapacity(terms: PricingTerms, capacityPaise: number): number {
  const factor = 1 + dailyRate(terms) * terms.tenureDays;
  const raw = Math.floor(capacityPaise / factor);
  return Math.max(0, raw - (raw % 50_000));
}
