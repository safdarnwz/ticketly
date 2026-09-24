import { describe, expect, it } from 'vitest';

import {
  approvalBlockers,
  canTransition,
  computeCompliance,
  minReason,
  normaliseRegistration,
  validateChassis,
  validateDocument,
  validateManufactureYear,
  validateRegistration,
  type DocVersion,
} from '../domain/vehicle-verification';

const TODAY = '2026-09-23';
const future = '2027-09-01';
const past = '2026-09-01';
const doc = (docType: string, over: Partial<DocVersion> = {}): DocVersion => ({
  id: `${docType}-${Math.random()}`,
  docType,
  documentNo: 'X1',
  validFrom: '2025-01-01',
  expiresOn: future,
  status: 'verified',
  hasFile: true,
  supersededAt: null,
  ...over,
});
const allVerified = () =>
  ['rc', 'insurance', 'permit', 'fitness', 'puc', 'road_tax'].map((t) => doc(t));

describe('registration number', () => {
  it('normalises spacing and case', () => {
    expect(normaliseRegistration(' mh 12-ab.1234 ')).toBe('MH12AB1234');
  });
  it('accepts standard and BH-series numbers', () => {
    expect(validateRegistration('MH12AB1234')).toEqual({ ok: true, value: 'MH12AB1234' });
    expect(validateRegistration('dl1cab1234')).toEqual({ ok: true, value: 'DL1CAB1234' });
    expect(validateRegistration('22 BH 1234 AB')).toEqual({ ok: true, value: '22BH1234AB' });
  });
  it('rejects bad formats, unknown state codes, 0000 and empty', () => {
    expect(validateRegistration('').ok).toBe(false);
    expect(validateRegistration('12AB1234').ok).toBe(false);
    expect(validateRegistration('XX12AB1234').ok).toBe(false);
    expect(validateRegistration('MH12AB0000').ok).toBe(false);
    expect(validateRegistration('MH12ABCD1234').ok).toBe(false);
  });
});

describe('chassis & year', () => {
  it('validates chassis (VIN rules)', () => {
    expect(validateChassis(undefined)).toBeNull();
    expect(validateChassis('MAT448123K1A12345')).toBeNull();
    expect(validateChassis('MAT44812IK1A12345')).not.toBeNull(); // contains I
    expect(validateChassis('ABC')).not.toBeNull();
  });
  it('validates manufacture year', () => {
    const now = new Date('2026-09-23');
    expect(validateManufactureYear(2020, now)).toBeNull();
    expect(validateManufactureYear(2027, now)).toBeNull();
    expect(validateManufactureYear(2028, now)).not.toBeNull();
    expect(validateManufactureYear(1970, now)).not.toBeNull();
  });
});

describe('document validation', () => {
  it('requires a known type, valid dates, and not already expired', () => {
    expect(
      validateDocument({
        docType: 'rc',
        documentNo: 'MH12AB1234',
        expiresOn: future,
        today: TODAY,
        registrationNo: 'MH12AB1234',
      }),
    ).toBeNull();
    expect(
      validateDocument({ docType: 'visa', documentNo: '1', expiresOn: future, today: TODAY }),
    ).toMatch(/Unknown/);
    expect(
      validateDocument({ docType: 'insurance', documentNo: '1', expiresOn: past, today: TODAY }),
    ).toMatch(/expired/);
    expect(
      validateDocument({
        docType: 'insurance',
        documentNo: '1',
        validFrom: '2027-12-01',
        expiresOn: future,
        today: TODAY,
      }),
    ).toMatch(/after the expiry/);
    expect(
      validateDocument({
        docType: 'insurance',
        documentNo: '1',
        validFrom: '2026-12-01',
        expiresOn: future,
        today: TODAY,
      }),
    ).toMatch(/future/);
    expect(
      validateDocument({
        docType: 'insurance',
        documentNo: '1',
        expiresOn: '2027-02-30x',
        today: TODAY,
      }),
    ).toMatch(/valid/);
  });
  it('requires a document number for required types', () => {
    expect(
      validateDocument({ docType: 'permit', documentNo: ' ', expiresOn: future, today: TODAY }),
    ).toMatch(/number is required/);
    expect(
      validateDocument({ docType: 'photo_front', expiresOn: future, today: TODAY }),
    ).toBeNull();
  });
  it('RC number must match the bus registration', () => {
    expect(
      validateDocument({
        docType: 'rc',
        documentNo: 'MH12AB9999',
        expiresOn: future,
        today: TODAY,
        registrationNo: 'MH12AB1234',
      }),
    ).toMatch(/does not match/);
    expect(
      validateDocument({
        docType: 'rc',
        documentNo: 'mh-12-ab-1234',
        expiresOn: future,
        today: TODAY,
        registrationNo: 'MH12AB1234',
      }),
    ).toBeNull();
  });
});

describe('compliance', () => {
  it('fully verified and valid → compliant, no blockers', () => {
    const c = computeCompliance(allVerified(), TODAY);
    expect(c.compliant).toBe(true);
    expect(approvalBlockers(c)).toEqual([]);
  });
  it('missing document blocks approval and submission', () => {
    const c = computeCompliance(
      allVerified().filter((d) => d.docType !== 'puc'),
      TODAY,
    );
    expect(c.compliant).toBe(false);
    expect(c.missing).toEqual(['puc']);
    expect(c.readyForSubmission).toBe(false);
    expect(approvalBlockers(c)[0]).toMatch(/Missing/);
  });
  it('pending upload: ready to submit, but not compliant until verified', () => {
    const docs = allVerified().map((d) =>
      d.docType === 'insurance' ? { ...d, status: 'pending' as const } : d,
    );
    const c = computeCompliance(docs, TODAY);
    expect(c.readyForSubmission).toBe(true);
    expect(c.compliant).toBe(false);
    expect(c.awaitingVerification).toEqual(['insurance']);
    expect(approvalBlockers(c)[0]).toMatch(/Not yet verified/);
  });
  it('pending upload without a file does not count', () => {
    const docs = allVerified().map((d) =>
      d.docType === 'insurance' ? { ...d, status: 'pending' as const, hasFile: false } : d,
    );
    expect(computeCompliance(docs, TODAY).readyForSubmission).toBe(false);
  });
  it('a renewal pending review does NOT remove compliance of the still-valid verified version', () => {
    const docs = [
      ...allVerified(),
      doc('insurance', { status: 'pending', expiresOn: '2028-09-01' }),
    ];
    const c = computeCompliance(docs, TODAY);
    expect(c.compliant).toBe(true);
    expect(c.pendingReview).toContain('insurance');
  });
  it('an expired verified document makes the bus non-compliant', () => {
    const docs = allVerified().map((d) =>
      d.docType === 'fitness' ? { ...d, expiresOn: past } : d,
    );
    const c = computeCompliance(docs, TODAY);
    expect(c.compliant).toBe(false);
    expect(c.expired).toEqual(['fitness']);
  });
  it('document expiring today is still valid; within 30 days is flagged', () => {
    const docs = allVerified().map((d) => (d.docType === 'puc' ? { ...d, expiresOn: TODAY } : d));
    const c = computeCompliance(docs, TODAY);
    expect(c.compliant).toBe(true);
    expect(c.expiringSoon).toEqual(['puc']);
  });
  it('rejected-only document blocks with a clear reason', () => {
    const docs = allVerified().map((d) =>
      d.docType === 'permit' ? { ...d, status: 'rejected' as const } : d,
    );
    const c = computeCompliance(docs, TODAY);
    expect(c.rejected).toEqual(['permit']);
    expect(approvalBlockers(c).join(' ')).toMatch(/Rejected: Permit/);
  });
  it('superseded versions are ignored', () => {
    const docs = allVerified().map((d) =>
      d.docType === 'rc' ? { ...d, supersededAt: '2026-01-01' } : d,
    );
    expect(computeCompliance(docs, TODAY).missing).toEqual(['rc']);
  });
});

describe('verification status machine', () => {
  it('operator submits; only admin approves/rejects', () => {
    expect(canTransition('draft', 'submitted', 'operator')).toBe(true);
    expect(canTransition('submitted', 'approved', 'operator')).toBe(false);
    expect(canTransition('submitted', 'approved', 'admin')).toBe(true);
    expect(canTransition('submitted', 'rejected', 'admin')).toBe(true);
    expect(canTransition('draft', 'approved', 'admin')).toBe(false); // must be submitted first
  });
  it('rejected and suspended buses can be resubmitted by the operator', () => {
    expect(canTransition('rejected', 'submitted', 'operator')).toBe(true);
    expect(canTransition('suspended', 'submitted', 'operator')).toBe(true);
  });
  it('system (expiry job) may suspend an approved bus; operator may not', () => {
    expect(canTransition('approved', 'suspended', 'system')).toBe(true);
    expect(canTransition('approved', 'suspended', 'operator')).toBe(false);
  });
  it('reason rules', () => {
    expect(minReason('short')).not.toBeNull();
    expect(minReason('Insurance copy is unreadable')).toBeNull();
    expect(minReason('x'.repeat(1001))).not.toBeNull();
  });
});
