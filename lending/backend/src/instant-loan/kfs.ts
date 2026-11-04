import { createHash } from 'crypto';
import { formatInr } from '../common/money';
import type { LoanOffer } from '../pricing/pricing.calc';
import type { PricingPolicy } from '../pricing/pricing-policy.entity';

export interface KeyFactStatement {
  version: 'KFS-1';
  applicationId: string;
  lender: string;
  generatedAt: string;
  validUntil: string;
  borrower: { name: string; mobile: string; panMasked: string };
  disbursalAccount: { last4: string; ifsc: string; note: string };
  loan: {
    type: string;
    sanctionedAmount: string;
    tenureDays: number;
    repaymentType: string;
    instalments: number;
    estimatedDueDateIfDisbursedToday: string;
    dueDateRule: string;
  };
  charges: { item: string; amount: string; deductedUpfront: boolean }[];
  netDisbursal: string;
  interest: { annualRatePercent: string; type: string; amount: string };
  totalAmountPayable: string;
  totalCostOfCredit: string;
  aprPercent: string;
  effectiveAnnualCostPercent: string;
  penalCharges: string;
  coolingOff: string;
  recovery: string;
  lendingServiceProvider: string;
  grievanceRedressal: string;
  notes: string[];
  raw: LoanOffer;
}

/** Deterministic JSON (sorted keys) so the hash the borrower accepts can be verified later. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

export const kfsHash = (k: KeyFactStatement) => createHash('sha256').update(stableStringify(k)).digest('hex');

const pct = (bps: number) => (bps / 100).toFixed(2);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function buildKfs(input: {
  applicationId: string;
  lender: string;
  grievanceOfficer: string;
  generatedAt: Date;
  validUntil: Date;
  borrower: { name: string; mobile: string; panMasked: string };
  bank: { last4: string; ifsc: string };
  offer: LoanOffer;
  policy: PricingPolicy;
}): KeyFactStatement {
  const { offer: o, policy: p } = input;
  return {
    version: 'KFS-1',
    applicationId: input.applicationId,
    lender: input.lender,
    generatedAt: input.generatedAt.toISOString(),
    validUntil: input.validUntil.toISOString(),
    borrower: { ...input.borrower, mobile: `XXXXXX${input.borrower.mobile.slice(-4)}` },
    disbursalAccount: { ...input.bank, note: 'Money is sent only to this verified account in your own name, directly from the lender.' },
    loan: {
      type: 'Short-term personal loan (unsecured)',
      sanctionedAmount: formatInr(o.principalPaise),
      tenureDays: o.tenureDays,
      repaymentType: 'Single (bullet) repayment',
      instalments: 1,
      estimatedDueDateIfDisbursedToday: addDays(input.generatedAt, o.tenureDays),
      dueDateRule: `${o.tenureDays} days from the date the money is credited to your account`,
    },
    charges: [
      { item: `Processing fee (${pct(p.processingFeeBps)}% of loan)`, amount: formatInr(o.processingFeePaise), deductedUpfront: true },
      { item: `GST on processing fee (${pct(p.gstOnFeeBps)}%)`, amount: formatInr(o.gstOnFeePaise), deductedUpfront: true },
    ],
    netDisbursal: formatInr(o.netDisbursalPaise),
    interest: { annualRatePercent: pct(o.annualInterestBps), type: 'Fixed, simple interest, actual/365', amount: formatInr(o.interestPaise) },
    totalAmountPayable: formatInr(o.totalRepayablePaise),
    totalCostOfCredit: formatInr(o.totalCostPaise),
    aprPercent: pct(o.aprBps),
    effectiveAnnualCostPercent: pct(o.effectiveAnnualBps),
    penalCharges: p.penalChargesText,
    coolingOff: `You may exit within ${p.coolingOffDays} days of disbursal by repaying the principal and proportionate APR, with no penalty.`,
    recovery: 'Reminders only by SMS, email or calls between 8 AM and 7 PM. No threats, no contact with your phone contacts.',
    lendingServiceProvider: 'None. The lender deals with you directly.',
    grievanceRedressal: `${input.grievanceOfficer}. If not resolved in 30 days you may complain on the RBI Complaint Management System (cms.rbi.org.in).`,
    notes: ['No charge that is not listed in this KFS will be collected.', 'You can download this KFS and the signed agreement from your dashboard.'],
    raw: o,
  };
}
