import { addDays, dues, inContactWindow, istDate, LoanTerms, penalForOneDay } from './loan.math';

const loan: LoanTerms = {
  principalPaise: 2_000_000, interestPaise: 29_589, totalRepayablePaise: 2_029_589, tenureDays: 30,
  disbursedOn: '2026-11-04', dueDate: '2026-12-04', coolingOffEndsOn: '2026-11-07',
  paidPaise: 0, penalAccruedPaise: 0, penalType: 'PERCENT_PER_DAY', penalValue: 0.1,
};

describe('dues', () => {
  it('charges at least one day of interest on the disbursal day (cooling-off)', () => {
    const d = dues(loan, '2026-11-04');
    expect(d.daysUsed).toBe(1);
    expect(d.interestTillTodayPaise).toBe(986);
    expect(d.outstandingPaise).toBe(2_000_986);
    expect(d.phase).toBe('COOLING_OFF');
  });

  it('charges interest only for days used when repaid early', () => {
    const d = dues(loan, '2026-11-14');
    expect(d.daysUsed).toBe(10);
    expect(d.outstandingPaise).toBe(2_000_000 + Math.round(29_589 / 3));
    expect(d.phase).toBe('BEFORE_DUE');
  });

  it('is the full contractual amount on the due date', () => {
    const d = dues(loan, '2026-12-04');
    expect(d.outstandingPaise).toBe(2_029_589);
    expect(d.phase).toBe('DUE_TODAY');
  });

  it('adds accrued penal after the due date and subtracts payments', () => {
    const d = dues({ ...loan, penalAccruedPaise: 6_000, paidPaise: 1_000_000 }, '2026-12-07');
    expect(d.overdueDays).toBe(3);
    expect(d.outstandingPaise).toBe(2_029_589 + 6_000 - 1_000_000);
    expect(d.phase).toBe('OVERDUE');
  });

  it('is PAID when nothing is outstanding', () => {
    expect(dues({ ...loan, paidPaise: 2_029_589 }, '2026-12-04').phase).toBe('PAID');
  });
});

describe('penalForOneDay', () => {
  it('is a percent of the unpaid contractual amount, never of penal', () => {
    expect(penalForOneDay({ ...loan, penalAccruedPaise: 50_000 })).toBe(Math.round(2_029_589 * 0.001));
    expect(penalForOneDay({ ...loan, penalType: 'FLAT_PER_DAY', penalValue: 25 })).toBe(2_500);
    expect(penalForOneDay({ ...loan, penalType: 'NONE' })).toBe(0);
    expect(penalForOneDay({ ...loan, paidPaise: 2_029_589 })).toBe(0);
  });
});

describe('IST helpers', () => {
  it('uses the Indian calendar date and contact window', () => {
    expect(istDate(new Date('2026-11-04T20:00:00Z'))).toBe('2026-11-05'); // 01:30 IST next day
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(inContactWindow(new Date('2026-11-04T04:30:00Z'))).toBe(true); // 10:00 IST
    expect(inContactWindow(new Date('2026-11-04T15:00:00Z'))).toBe(false); // 20:30 IST
  });
});
