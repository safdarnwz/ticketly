import { describe, it, expect } from 'vitest';

import {
  approvalBlockers,
  assertReview,
  canReview,
  isTerminal,
  targetOf,
} from '../domain/application-status';

const READY = {
  companyName: 'Orange Travels',
  email: 'ops@orange.example',
  mobile: '+919800000001',
  gstNumber: '29AAACO1234C1Z5',
  panNumber: 'AAACO1234C',
  panVerificationStatus: 'verified',
  bankAccountHolder: 'Orange Travels',
  bankAccountNumber: '123456789012',
  bankIfsc: 'HDFC0001234',
};

describe('operator application review', () => {
  it('pending → approve / reject / hold', () => {
    expect(canReview('pending', 'approve')).toBe(true);
    expect(canReview('pending', 'reject')).toBe(true);
    expect(canReview('pending', 'hold')).toBe(true);
    expect(targetOf('hold')).toBe('pending');
  });
  it('rejected can only be reopened back to pending', () => {
    expect(canReview('rejected', 'reopen')).toBe(true);
    expect(canReview('rejected', 'approve')).toBe(false); // must be re-reviewed from pending
    expect(targetOf('reopen')).toBe('pending');
  });
  it('approved is terminal — nothing moves it', () => {
    expect(isTerminal('approved')).toBe(true);
    for (const a of ['approve', 'reject', 'hold', 'reopen'] as const)
      expect(canReview('approved', a)).toBe(false);
    expect(() => assertReview('approved', 'reject', 'fraudulent documents found')).toThrow();
  });
  it('reject / hold / reopen require a real reason; approve does not', () => {
    expect(() => assertReview('pending', 'reject', '')).toThrow();
    expect(() => assertReview('pending', 'reject', 'bad docs')).toThrow(); // < 10 chars
    expect(() => assertReview('pending', 'reject', 'GST certificate is illegible')).not.toThrow();
    expect(() => assertReview('pending', 'hold', '   ')).toThrow();
    expect(() => assertReview('rejected', 'reopen', 'Applicant sent corrected PAN')).not.toThrow();
    expect(() => assertReview('pending', 'approve')).not.toThrow();
    expect(() => assertReview('pending', 'approve', 'x'.repeat(1001))).toThrow();
  });
});

describe('approval readiness', () => {
  it('a complete, consistent application has no blockers', () => {
    expect(approvalBlockers(READY)).toEqual([]);
  });
  it('flags missing bank details (settlement impossible)', () => {
    expect(approvalBlockers({ ...READY, bankIfsc: null }).join()).toMatch(/Bank account details/);
  });
  it('flags GSTIN not belonging to the PAN', () => {
    expect(approvalBlockers({ ...READY, panNumber: 'AAACX9999C' }).join()).toMatch(
      /not registered to PAN/,
    );
  });
  it('flags invalid formats and failed KYC', () => {
    expect(approvalBlockers({ ...READY, gstNumber: '29AAAA' }).join()).toMatch(/GSTIN/);
    expect(approvalBlockers({ ...READY, bankIfsc: 'HDFC1001234' }).join()).toMatch(/IFSC/);
    expect(approvalBlockers({ ...READY, bankAccountNumber: '12AB' }).join()).toMatch(/9–18 digits/);
    expect(approvalBlockers({ ...READY, panVerificationStatus: 'failed' }).join()).toMatch(
      /PAN verification failed/,
    );
  });
});
