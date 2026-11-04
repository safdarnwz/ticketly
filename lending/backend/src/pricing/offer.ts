import { computeOffer, LoanOffer } from './pricing.calc';
import type { PenalType, PlanScope, PricingPlan } from './pricing-plan.entity';
import type { FeeType, InterestUnit } from './pricing.calc';

/**
 * An offer with every term copied from the plan at the moment it was made. The KFS, the
 * agreement and the loan use only this snapshot, so later plan edits by the owner can never
 * change what a customer has already seen or signed.
 */
export interface FrozenOffer extends LoanOffer {
  planId: string;
  planName: string;
  planScope: PlanScope;
  customerLabel: string | null;
  interestUnit: InterestUnit;
  interestRatePercent: number;
  feeType: FeeType;
  feeValue: number;
  gstPercent: number;
  penalType: PenalType;
  penalValue: number;
  coolingOffDays: number;
  aprCapPercent: number | null;
}

export function freezeOffer(plan: PricingPlan, principalPaise: number): FrozenOffer {
  return {
    ...computeOffer(plan, principalPaise),
    planId: plan.id,
    planName: plan.name,
    planScope: plan.scope,
    customerLabel: plan.customerLabel,
    interestUnit: plan.interestUnit,
    interestRatePercent: plan.interestRatePercent,
    feeType: plan.feeType,
    feeValue: plan.feeValue,
    gstPercent: plan.gstPercent,
    penalType: plan.penalType,
    penalValue: plan.penalValue,
    coolingOffDays: plan.coolingOffDays,
    aprCapPercent: plan.aprCapPercent,
  };
}
