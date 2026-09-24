import { describe, expect, it } from 'vitest';

import {
  captureEntry,
  LedgerAccounts,
  LedgerTransaction,
  offlineCaptureEntry,
  offlineRefundEntry,
  partnerCommissionEntry,
  partnerCommissionReversalEntry,
  refundEntry,
  settlementEntry,
} from '../domain/ledger';

describe('LedgerTransaction — the balance invariant', () => {
  it('accepts a balanced entry', () => {
    const tx = LedgerTransaction.create({
      type: 't',
      currency: 'INR',
      sourceType: 'booking',
      sourceId: 'b1',
      postings: [
        { account: 'gateway_clearing', amountMinor: 100000 },
        { account: 'operator_payable', amountMinor: -100000 },
      ],
    });
    expect(tx.magnitude.minor).toBe(100000);
  });

  it('rejects an unbalanced entry', () => {
    expect(() =>
      LedgerTransaction.create({
        type: 't',
        currency: 'INR',
        sourceType: 'b',
        sourceId: '1',
        postings: [
          { account: 'a', amountMinor: 100000 },
          { account: 'b', amountMinor: -90000 },
        ],
      }),
    ).toThrow(/does not balance/);
  });

  it('rejects a single-posting entry', () => {
    expect(() =>
      LedgerTransaction.create({
        type: 't',
        currency: 'INR',
        sourceType: 'b',
        sourceId: '1',
        postings: [{ account: 'a', amountMinor: 0 }],
      }),
    ).toThrow(/at least two postings/);
  });

  it('rejects a zero posting', () => {
    expect(() =>
      LedgerTransaction.create({
        type: 't',
        currency: 'INR',
        sourceType: 'b',
        sourceId: '1',
        postings: [
          { account: 'a', amountMinor: 100 },
          { account: 'b', amountMinor: 0 },
          { account: 'c', amountMinor: -100 },
        ],
      }),
    ).toThrow(/cannot be zero/);
  });
});

const sum = (tx: LedgerTransaction) => tx.postings.reduce((s, p) => s + p.amountMinor, 0);
const byAccount = (tx: LedgerTransaction) =>
  Object.fromEntries(tx.postings.map((p) => [p.account, p.amountMinor]));

describe('captureEntry (platform collected the money)', () => {
  it('splits into operator share, commission and commission GST — and balances', () => {
    const tx = captureEntry({
      currency: 'INR',
      bookingId: 'b1',
      operatorId: 'op',
      totalMinor: 105000,
      commissionMinor: 10000,
      commissionGstMinor: 1800,
    });
    const a = byAccount(tx);
    expect(a[LedgerAccounts.GATEWAY_CLEARING]).toBe(105000);
    expect(a[LedgerAccounts.OPERATOR_PAYABLE]).toBe(-93200); // fare + fare GST pass through to the operator
    expect(a[LedgerAccounts.PLATFORM_REVENUE]).toBe(-10000);
    expect(a[LedgerAccounts.COMMISSION_TAX_PAYABLE]).toBe(-1800);
    expect(sum(tx)).toBe(0);
  });

  it('negative: commission + commission GST larger than the total is rejected', () => {
    expect(() =>
      captureEntry({
        currency: 'INR',
        bookingId: 'b',
        operatorId: 'op',
        totalMinor: 10000,
        commissionMinor: 9000,
        commissionGstMinor: 1620,
      }),
    ).toThrow(/exceed the booking total/);
  });

  it('edge: zero commission drops the zero postings and still balances', () => {
    const tx = captureEntry({
      currency: 'INR',
      bookingId: 'b',
      operatorId: 'op',
      totalMinor: 100000,
      commissionMinor: 0,
      commissionGstMinor: 0,
    });
    expect(tx.postings.every((p) => p.amountMinor !== 0)).toBe(true);
    expect(tx.postings).toHaveLength(2);
    expect(sum(tx)).toBe(0);
  });

  it('edge: commission exactly equal to the total leaves no operator posting', () => {
    const tx = captureEntry({
      currency: 'INR',
      bookingId: 'b',
      operatorId: 'op',
      totalMinor: 11800,
      commissionMinor: 10000,
      commissionGstMinor: 1800,
    });
    expect(byAccount(tx)[LedgerAccounts.OPERATOR_PAYABLE]).toBeUndefined();
    expect(sum(tx)).toBe(0);
  });
});

describe('refundEntry & settlementEntry', () => {
  it('a refund reverses operator, commission and commission GST legs — and balances', () => {
    const tx = refundEntry({
      currency: 'INR',
      bookingId: 'b1',
      operatorId: 'op',
      refundMinor: 90000,
      operatorClawbackMinor: 79900,
      commissionClawbackMinor: 8559,
      commissionGstClawbackMinor: 1541,
    });
    expect(sum(tx)).toBe(0);
  });

  it('negative: clawbacks that do not add up to the refund are rejected (never an unbalanced book)', () => {
    expect(() =>
      refundEntry({
        currency: 'INR',
        bookingId: 'b1',
        operatorId: 'op',
        refundMinor: 90000,
        operatorClawbackMinor: 80000,
        commissionClawbackMinor: 9000,
        commissionGstClawbackMinor: 1620,
      }),
    ).toThrow();
  });

  it('a settlement moves the operator payable out — and balances', () => {
    const tx = settlementEntry({
      currency: 'INR',
      settlementId: 's1',
      operatorId: 'op',
      amountMinor: 500000,
    });
    expect(sum(tx)).toBe(0);
  });
});

describe('offline (B2B agent) capture & refund — operator holds the cash', () => {
  it('capture books only the commission the operator owes; gateway_clearing is untouched', () => {
    const tx = offlineCaptureEntry({
      currency: 'INR',
      bookingId: 'b',
      operatorId: 'op',
      commissionMinor: 5000,
      commissionGstMinor: 900,
    });
    const a = byAccount(tx);
    expect(a[LedgerAccounts.GATEWAY_CLEARING]).toBeUndefined();
    expect(a[LedgerAccounts.OPERATOR_PAYABLE]).toBe(5900);
    expect(a[LedgerAccounts.PLATFORM_REVENUE]).toBe(-5000);
    expect(a[LedgerAccounts.COMMISSION_TAX_PAYABLE]).toBe(-900);
    expect(sum(tx)).toBe(0);
  });

  it('refund gives back the commission share to the operator payable — and balances', () => {
    const tx = offlineRefundEntry({
      currency: 'INR',
      bookingId: 'b',
      operatorId: 'op',
      commissionClawbackMinor: 2500,
      commissionGstClawbackMinor: 450,
    })!;
    expect(byAccount(tx)[LedgerAccounts.OPERATOR_PAYABLE]).toBe(-2950);
    expect(sum(tx)).toBe(0);
  });

  it('edge: a zero clawback produces no transaction at all', () => {
    expect(
      offlineRefundEntry({
        currency: 'INR',
        bookingId: 'b',
        operatorId: 'op',
        commissionClawbackMinor: 0,
        commissionGstClawbackMinor: 0,
      }),
    ).toBeNull();
  });
});

describe('GDS partner commission', () => {
  it('capture + partner commission: clearing nets to what the partner actually paid', () => {
    const cap = captureEntry({
      currency: 'INR',
      bookingId: 'b',
      operatorId: 'op',
      totalMinor: 105000,
      commissionMinor: 10000,
      commissionGstMinor: 1800,
    });
    const pc = partnerCommissionEntry({
      currency: 'INR',
      bookingId: 'b',
      operatorId: 'op',
      partnerCommissionMinor: 8000,
    })!;
    const clearing = [...cap.postings, ...pc.postings]
      .filter((p) => p.account === LedgerAccounts.GATEWAY_CLEARING)
      .reduce((s, p) => s + p.amountMinor, 0);
    expect(clearing).toBe(97000); // 1050 − 80 partner commission
    expect(pc.postings.reduce((s, p) => s + p.amountMinor, 0)).toBe(0);
  });
  it('reversal balances; zero amounts produce no entry', () => {
    expect(
      partnerCommissionReversalEntry({
        currency: 'INR',
        bookingId: 'b',
        operatorId: 'op',
        clawbackMinor: 4000,
      })!.postings.reduce((s, p) => s + p.amountMinor, 0),
    ).toBe(0);
    expect(
      partnerCommissionEntry({
        currency: 'INR',
        bookingId: 'b',
        operatorId: 'op',
        partnerCommissionMinor: 0,
      }),
    ).toBeNull();
    expect(
      partnerCommissionReversalEntry({
        currency: 'INR',
        bookingId: 'b',
        operatorId: 'op',
        clawbackMinor: 0,
      }),
    ).toBeNull();
  });
});
