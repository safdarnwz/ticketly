import { createHash } from 'crypto';
import { formatInr } from '../common/money';
import type { FrozenOffer } from '../pricing/offer';

export interface KeyFactStatement {
  version: 'KFS-1';
  applicationId: string;
  lender: string;
  offerName: string | null;
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
  interest: { rate: string; perDayPercent: string; perAnnumPercent: string; type: string; amount: string };
  totalAmountPayable: string;
  totalCostOfCredit: string;
  aprPercent: string;
  effectiveAnnualCostPercent: string;
  penalCharges: string;
  coolingOff: string;
  repayment: string;
  prepayment: string;
  recovery: string;
  lendingServiceProvider: string;
  grievanceRedressal: string;
  notes: string[];
  raw: FrozenOffer;
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
const trim = (n: number, dp = 6) => String(Number(n.toFixed(dp)));

export function penalText(o: Pick<FrozenOffer, 'penalType' | 'penalValue'>): string {
  if (o.penalType === 'NONE' || !o.penalValue) return 'No penal charges.';
  const v = o.penalType === 'PERCENT_PER_DAY' ? `${trim(o.penalValue, 4)}% per day of the overdue amount` : `${formatInr(Math.round(o.penalValue * 100))} per day`;
  return `${v}, only after the due date, on the overdue amount only. Not added to interest, no compounding.`;
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);

export function buildKfs(input: {
  applicationId: string;
  lender: string;
  grievanceOfficer: string;
  generatedAt: Date;
  validUntil: Date;
  borrower: { name: string; mobile: string; panMasked: string };
  bank: { last4: string; ifsc: string };
  offer: FrozenOffer;
}): KeyFactStatement {
  const o = input.offer;
  return {
    version: 'KFS-1',
    applicationId: input.applicationId,
    lender: input.lender,
    offerName: o.customerLabel,
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
      { item: o.feeType === 'PERCENT' ? `Processing fee (${trim(o.feeValue, 4)}% of loan)` : 'Processing fee (flat)', amount: formatInr(o.processingFeePaise), deductedUpfront: true },
      { item: `GST on processing fee (${trim(o.gstPercent, 3)}%)`, amount: formatInr(o.gstOnFeePaise), deductedUpfront: true },
    ],
    netDisbursal: formatInr(o.netDisbursalPaise),
    interest: {
      rate: o.interestUnit === 'PER_DAY'
        ? `${trim(o.interestRatePercent)}% per day (${trim(o.annualInterestPercent, 2)}% per year)`
        : `${trim(o.interestRatePercent)}% per year (${trim(o.dailyInterestPercent, 4)}% per day)`,
      perDayPercent: trim(o.dailyInterestPercent),
      perAnnumPercent: trim(o.annualInterestPercent, 4),
      type: 'Fixed, simple interest on the loan amount',
      amount: formatInr(o.interestPaise),
    },
    totalAmountPayable: formatInr(o.totalRepayablePaise),
    totalCostOfCredit: formatInr(o.totalCostPaise),
    aprPercent: pct(o.aprBps),
    effectiveAnnualCostPercent: pct(o.effectiveAnnualBps),
    penalCharges: penalText(o),
    coolingOff: `You may exit within ${o.coolingOffDays} days of disbursal by repaying the principal and interest for the days used, with no penalty.`,
    repayment: 'You repay yourself by UPI, net banking or debit card from your loan dashboard or the link in our SMS. No auto-debit (eNACH/NACH) mandate is taken. Money goes directly to the lender’s bank account.',
    prepayment: 'You can repay early at any time with no prepayment charge. Interest is charged only for the days you used the money (minimum 1 day).',
    recovery: 'Reminders only by SMS, email or calls between 8 AM and 7 PM. No threats, no contact with your phone contacts.',
    lendingServiceProvider: 'None. The lender deals with you directly.',
    grievanceRedressal: `${input.grievanceOfficer}. If not resolved in 30 days you may complain on the RBI Complaint Management System (cms.rbi.org.in).`,
    notes: ['No charge that is not listed in this KFS will be collected.', 'You can download this KFS and the signed agreement from your dashboard.'],
    raw: o,
  };
}
