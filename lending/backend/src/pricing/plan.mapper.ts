import { rupeesToPaise } from '../common/money';
import type { PlanDto, UpdatePlanDto } from '../instant-loan/dto';
import type { PlanInput } from './pricing.service';

const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

/** Converts the owner's form (rupees, ISO dates) into plan fields (paise, Date). */
export function toPlanPatch(d: UpdatePlanDto): Partial<PlanInput> {
  const out: Partial<PlanInput> = {};
  const set = <K extends keyof PlanInput>(k: K, v: PlanInput[K] | undefined) => { if (v !== undefined) out[k] = v; };
  set('name', d.name);
  set('scope', d.scope);
  set('customerMobile', d.customerMobile);
  set('customerLabel', d.customerLabel);
  set('priority', d.priority);
  set('active', d.active);
  set('validFrom', date(d.validFrom));
  set('validUntil', date(d.validUntil));
  set('maxUses', d.maxUses);
  set('interestUnit', d.interestUnit);
  set('interestRatePercent', d.interestRatePercent);
  set('feeType', d.feeType);
  set('feeValue', d.feeValue);
  set('gstPercent', d.gstPercent);
  set('tenureDays', d.tenureDays);
  set('minPrincipalPaise', d.minAmount === undefined ? undefined : rupeesToPaise(d.minAmount));
  set('maxPrincipalPaise', d.maxAmount === undefined ? undefined : rupeesToPaise(d.maxAmount));
  set('penalType', d.penalType);
  set('penalValue', d.penalValue);
  set('coolingOffDays', d.coolingOffDays);
  set('aprCapPercent', d.aprCapPercent);
  return out;
}

export function toPlanInput(d: PlanDto): PlanInput {
  return {
    customerMobile: null, customerLabel: null, priority: 0, active: true, validFrom: null, validUntil: null, maxUses: null,
    penalType: 'NONE', penalValue: 0, coolingOffDays: 3, aprCapPercent: null,
    ...toPlanPatch(d),
  } as PlanInput;
}
