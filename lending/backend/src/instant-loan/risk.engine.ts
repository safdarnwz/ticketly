import type { BureauReport } from '../integrations/ports';
import { maxPrincipalForCapacity, PricingTerms } from '../pricing/pricing.calc';

export type Decision = 'APPROVE' | 'REJECT' | 'MANUAL_REVIEW';

export interface RiskInput {
  ageYears: number;
  monthlyIncomePaise: number;
  existingEmiPaise: number;
  requestedPrincipalPaise: number;
  employmentType: 'SALARIED' | 'SELF_EMPLOYED';
  bureau: BureauReport;
  nameMatchScore: number;
  applicationsFromIpLast24h: number;
  applicationsFromDeviceLast24h: number;
  panUsedByOtherCustomer: boolean;
  openApplicationsForCustomer: number;
}

export interface RiskPolicy {
  minAge: number;
  maxAge: number;
  minBureauScore: number;
  /** Scores in [minBureauScore, autoApproveScore) go to a human underwriter. */
  autoApproveScore: number;
  /** Share of monthly income (after existing EMIs) the bullet repayment may consume. */
  maxRepaymentToIncomeBps: number;
  minMonthlyIncomePaise: number;
  maxVelocityPerIp: number;
  maxVelocityPerDevice: number;
  minNameMatch: number;
  autoNameMatch: number;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  minAge: 21,
  maxAge: 58,
  minBureauScore: 650,
  autoApproveScore: 700,
  maxRepaymentToIncomeBps: 5000,
  minMonthlyIncomePaise: 1_500_000, // ₹15,000
  maxVelocityPerIp: 5,
  maxVelocityPerDevice: 3,
  minNameMatch: 0.75,
  autoNameMatch: 0.9,
};

export interface RiskResult {
  decision: Decision;
  approvedPrincipalPaise: number;
  reasons: string[];
}

/**
 * Deterministic, explainable rules. Every decision carries reason codes, which are stored on
 * the application and can be shown to the customer (rejection reasons) and to auditors.
 */
export function assessRisk(
  input: RiskInput,
  terms: PricingTerms,
  limits: { minPrincipalPaise: number; maxPrincipalPaise: number },
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): RiskResult {
  const reject: string[] = [];
  const refer: string[] = [];
  const b = input.bureau;

  // Fraud and identity
  if (input.panUsedByOtherCustomer) reject.push('FRAUD_PAN_ON_OTHER_ACCOUNT');
  if (input.applicationsFromIpLast24h > policy.maxVelocityPerIp) reject.push('FRAUD_IP_VELOCITY');
  if (input.applicationsFromDeviceLast24h > policy.maxVelocityPerDevice) reject.push('FRAUD_DEVICE_VELOCITY');
  if (input.nameMatchScore < policy.minNameMatch) reject.push('BANK_NAME_MISMATCH');
  else if (input.nameMatchScore < policy.autoNameMatch) refer.push('BANK_NAME_PARTIAL_MATCH');
  if (input.openApplicationsForCustomer > 0) reject.push('ACTIVE_LOAN_OR_APPLICATION_EXISTS');

  // Eligibility
  if (input.ageYears < policy.minAge || input.ageYears > policy.maxAge) reject.push('AGE_OUT_OF_RANGE');
  if (input.monthlyIncomePaise < policy.minMonthlyIncomePaise) reject.push('INCOME_BELOW_MINIMUM');

  // Bureau
  if (b.writtenOffOrSettled) reject.push('BUREAU_WRITE_OFF_OR_SETTLED');
  if (b.maxDpdLast12m >= 90) reject.push('BUREAU_DPD_90_PLUS');
  else if (b.maxDpdLast12m >= 30) refer.push('BUREAU_DPD_30_PLUS');
  if (b.score === null) refer.push('NEW_TO_CREDIT');
  else if (b.score < policy.minBureauScore) reject.push('BUREAU_SCORE_LOW');
  else if (b.score < policy.autoApproveScore) refer.push('BUREAU_SCORE_BORDERLINE');
  if (b.enquiriesLast30d > 6) refer.push('BUREAU_MANY_RECENT_ENQUIRIES');
  if (input.employmentType === 'SELF_EMPLOYED') refer.push('SELF_EMPLOYED_INCOME_CHECK');

  // Repayment capacity: bullet repayment must fit within X% of income left after EMIs.
  const free = input.monthlyIncomePaise - input.existingEmiPaise - b.totalEmiPaise;
  const capacity = Math.floor((Math.max(0, free) * policy.maxRepaymentToIncomeBps) / 10_000);
  const affordable = maxPrincipalForCapacity(terms, capacity);
  const approved = Math.min(input.requestedPrincipalPaise, limits.maxPrincipalPaise, affordable);
  if (approved < limits.minPrincipalPaise) reject.push('INSUFFICIENT_REPAYMENT_CAPACITY');

  if (reject.length) return { decision: 'REJECT', approvedPrincipalPaise: 0, reasons: reject };
  const reasons = [...refer];
  if (approved < input.requestedPrincipalPaise) reasons.push('AMOUNT_REDUCED_TO_CAPACITY');
  return { decision: refer.length ? 'MANUAL_REVIEW' : 'APPROVE', approvedPrincipalPaise: approved, reasons };
}

/** Token-based similarity between KYC name and bank-registered name (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toUpperCase().replace(/\b(MR|MRS|MS|DR|SHRI|SMT)\b\.?/g, ' ').replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  const ta = norm(a);
  const tb = norm(b);
  if (!ta.length || !tb.length) return 0;
  const matched = ta.filter((t) => tb.some((u) => u === t || (t.length === 1 && u.startsWith(t)) || (u.length === 1 && t.startsWith(u))));
  return Math.round((matched.length / Math.max(ta.length, tb.length)) * 1000) / 1000;
}
