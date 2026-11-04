import { assessRisk, nameSimilarity, RiskInput } from './risk.engine';

const terms = { interestUnit: 'PER_ANNUM' as const, interestRatePercent: 18, feeType: 'PERCENT' as const, feeValue: 1, gstPercent: 18, tenureDays: 30 };
const limits = { minPrincipalPaise: 1_000_000, maxPrincipalPaise: 3_000_000 };
const base: RiskInput = {
  ageYears: 30,
  monthlyIncomePaise: 6_000_000,
  existingEmiPaise: 0,
  requestedPrincipalPaise: 2_000_000,
  employmentType: 'SALARIED',
  bureau: { score: 760, maxDpdLast12m: 0, writtenOffOrSettled: false, activeLoans: 1, totalEmiPaise: 500_000, enquiriesLast30d: 1, reportRef: 'r' },
  nameMatchScore: 1,
  applicationsFromIpLast24h: 1,
  applicationsFromDeviceLast24h: 1,
  panUsedByOtherCustomer: false,
  openApplicationsForCustomer: 0,
};

describe('assessRisk', () => {
  it('auto-approves a clean salaried applicant', () => {
    const r = assessRisk(base, terms, limits);
    expect(r.decision).toBe('APPROVE');
    expect(r.approvedPrincipalPaise).toBe(2_000_000);
  });

  it('refers borderline bureau scores to a human', () => {
    expect(assessRisk({ ...base, bureau: { ...base.bureau, score: 680 } }, terms, limits).decision).toBe('MANUAL_REVIEW');
  });

  it('rejects low scores, write-offs and fraud signals', () => {
    expect(assessRisk({ ...base, bureau: { ...base.bureau, score: 600 } }, terms, limits).reasons).toContain('BUREAU_SCORE_LOW');
    expect(assessRisk({ ...base, bureau: { ...base.bureau, writtenOffOrSettled: true } }, terms, limits).decision).toBe('REJECT');
    expect(assessRisk({ ...base, panUsedByOtherCustomer: true }, terms, limits).decision).toBe('REJECT');
  });

  it('reduces the amount to repayment capacity', () => {
    const r = assessRisk({ ...base, monthlyIncomePaise: 3_000_000, requestedPrincipalPaise: 3_000_000 }, terms, limits);
    expect(r.decision).toBe('APPROVE');
    expect(r.approvedPrincipalPaise).toBeLessThan(3_000_000);
    expect(r.reasons).toContain('AMOUNT_REDUCED_TO_CAPACITY');
  });

  it('rejects when even the minimum loan is unaffordable', () => {
    const r = assessRisk({ ...base, monthlyIncomePaise: 1_600_000, existingEmiPaise: 1_000_000 }, terms, limits);
    expect(r.reasons).toContain('INSUFFICIENT_REPAYMENT_CAPACITY');
  });
});

describe('nameSimilarity', () => {
  it('handles titles, initials and order', () => {
    expect(nameSimilarity('Rahul Kumar Sharma', 'MR RAHUL K SHARMA')).toBe(1);
    expect(nameSimilarity('Rahul Sharma', 'Priya Verma')).toBe(0);
  });
});
