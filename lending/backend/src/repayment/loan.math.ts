/** Loan dues maths. Dates are IST calendar dates (YYYY-MM-DD); amounts are paise. */

export const istDate = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const istHour = (d: Date = new Date()) => Number(d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface LoanTerms {
  principalPaise: number;
  interestPaise: number; // full-tenure interest
  totalRepayablePaise: number;
  tenureDays: number;
  disbursedOn: string;
  dueDate: string;
  coolingOffEndsOn: string | null;
  paidPaise: number;
  penalAccruedPaise: number;
  penalType: 'NONE' | 'PERCENT_PER_DAY' | 'FLAT_PER_DAY';
  penalValue: number;
}

export type DuePhase = 'COOLING_OFF' | 'BEFORE_DUE' | 'DUE_TODAY' | 'OVERDUE' | 'PAID';

export interface Dues {
  today: string;
  daysUsed: number;
  interestTillTodayPaise: number;
  contractualPaise: number;
  penalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  overdueDays: number;
  phase: DuePhase;
}

/**
 * What the borrower owes today.
 *  - Before the due date: principal + interest only for the days used (min 1 day). No prepayment charge.
 *  - From the due date: the full contractual amount (principal + full interest).
 *  - After the due date: plus penal charges accrued so far, kept separate from interest.
 */
export function dues(l: LoanTerms, today: string): Dues {
  const daysUsed = Math.max(1, daysBetween(l.disbursedOn, today));
  const interest = daysUsed >= l.tenureDays ? l.interestPaise : Math.round((l.interestPaise * daysUsed) / l.tenureDays);
  const contractual = l.principalPaise + interest;
  const outstanding = Math.max(0, contractual + l.penalAccruedPaise - l.paidPaise);
  const overdueDays = Math.max(0, daysBetween(l.dueDate, today));
  const phase: DuePhase =
    outstanding === 0 ? 'PAID'
    : overdueDays > 0 ? 'OVERDUE'
    : today === l.dueDate ? 'DUE_TODAY'
    : l.coolingOffEndsOn && today <= l.coolingOffEndsOn ? 'COOLING_OFF'
    : 'BEFORE_DUE';
  return { today, daysUsed, interestTillTodayPaise: interest, contractualPaise: contractual, penalPaise: l.penalAccruedPaise, paidPaise: l.paidPaise, outstandingPaise: outstanding, overdueDays, phase };
}

/** Penal for one overdue day, on the unpaid contractual amount only (never on penal itself). */
export function penalForOneDay(l: Pick<LoanTerms, 'penalType' | 'penalValue' | 'totalRepayablePaise' | 'paidPaise' | 'penalAccruedPaise'>): number {
  // Payments go to the contractual amount first, so the overdue base is what is still unpaid of it.
  const base = Math.max(0, l.totalRepayablePaise - l.paidPaise);
  if (base === 0 || l.penalType === 'NONE' || !l.penalValue) return 0;
  return l.penalType === 'PERCENT_PER_DAY' ? Math.round((base * l.penalValue) / 100) : Math.round(l.penalValue * 100);
}

/** Reminder schedule relative to the due date (days). No auto-debit, so reminders matter. */
export const REMINDERS: { kind: string; offset: number; template: string }[] = [
  { kind: 'REMINDER_D-3', offset: -3, template: 'REPAYMENT_REMINDER' },
  { kind: 'REMINDER_D-1', offset: -1, template: 'REPAYMENT_REMINDER' },
  { kind: 'DUE_TODAY', offset: 0, template: 'REPAYMENT_DUE_TODAY' },
  { kind: 'OVERDUE_D+1', offset: 1, template: 'REPAYMENT_OVERDUE' },
  { kind: 'OVERDUE_D+3', offset: 3, template: 'REPAYMENT_OVERDUE' },
  { kind: 'OVERDUE_D+7', offset: 7, template: 'REPAYMENT_OVERDUE' },
];

/** Fair Practices Code: contact borrowers only between 8 AM and 7 PM. We use 9 AM–7 PM IST. */
export const inContactWindow = (d: Date = new Date()) => {
  const h = istHour(d);
  return h >= 9 && h < 19;
};
