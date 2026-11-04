/** Pure pricing maths. All amounts in paise, all rates in basis points. */
export interface PricingTerms {
  annualInterestBps: number;
  processingFeeBps: number;
  gstOnFeeBps: number;
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
  annualInterestBps: number;
  /** APR: annualised cost on the amount actually received (RBI KFS method, bullet loan). */
  aprBps: number;
  /** Compounded (effective) annual cost, shown for transparency. */
  effectiveAnnualBps: number;
}

const roundPaise = (x: number) => Math.round(x);

export function computeOffer(terms: PricingTerms, principalPaise: number): LoanOffer {
  if (!Number.isInteger(principalPaise) || principalPaise <= 0) throw new Error('principal must be positive paise');
  const fee = roundPaise((principalPaise * terms.processingFeeBps) / 10_000);
  const gst = roundPaise((fee * terms.gstOnFeeBps) / 10_000);
  const net = principalPaise - fee - gst;
  // Simple interest on the sanctioned principal for the tenure, actual/365.
  const interest = roundPaise((principalPaise * terms.annualInterestBps * terms.tenureDays) / (10_000 * 365));
  const total = principalPaise + interest;
  const cost = total - net;
  const periodRate = cost / net;
  const apr = periodRate * (365 / terms.tenureDays);
  const effective = Math.pow(1 + periodRate, 365 / terms.tenureDays) - 1;
  return {
    principalPaise,
    processingFeePaise: fee,
    gstOnFeePaise: gst,
    netDisbursalPaise: net,
    interestPaise: interest,
    totalRepayablePaise: total,
    totalCostPaise: cost,
    tenureDays: terms.tenureDays,
    annualInterestBps: terms.annualInterestBps,
    aprBps: Math.round(apr * 10_000),
    effectiveAnnualBps: Math.round(effective * 10_000),
  };
}

/** Largest principal (rounded down to ₹500) whose total repayment fits within `capacityPaise`. */
export function maxPrincipalForCapacity(terms: PricingTerms, capacityPaise: number): number {
  const factor = 1 + (terms.annualInterestBps * terms.tenureDays) / (10_000 * 365);
  const raw = Math.floor(capacityPaise / factor);
  return Math.max(0, raw - (raw % 50_000));
}
