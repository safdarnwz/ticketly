import { describe, expect, it } from 'vitest';

import {
  agentCommissionMinor, canTransition, checkFunds, commissionClawbackMinor,
  isLowBalance, netCostMinor, signedAmount, spendableMinor, validateTerms,
} from '../domain/agent-account';

describe('agent account — signedAmount', () => {
  it('debits and credits by kind', () => {
    expect(signedAmount('deposit', 1000)).toBe(1000);
    expect(signedAmount('payment_received', 1000)).toBe(1000);
    expect(signedAmount('booking_debit', 1000)).toBe(-1000);
    expect(signedAmount('commission_credit', 50)).toBe(50);
    expect(signedAmount('booking_reversal', 1000)).toBe(1000);
    expect(signedAmount('refund_credit', 800)).toBe(800);
    expect(signedAmount('commission_reversal', 40)).toBe(-40);
  });
  it('adjustment keeps its own sign', () => {
    expect(signedAmount('adjustment', -250)).toBe(-250);
    expect(signedAmount('adjustment', 250)).toBe(250);
  });
  it('rejects non-positive or fractional magnitudes', () => {
    expect(() => signedAmount('deposit', 0)).toThrow();
    expect(() => signedAmount('booking_debit', -5)).toThrow();
    expect(() => signedAmount('deposit', 10.5)).toThrow();
  });
});

describe('agent account — commission', () => {
  it('is earned on the net fare, never on GST', () => {
    // ₹1050 ticket incl. ₹50 GST, 5% → 5% of ₹1000 = ₹50
    expect(agentCommissionMinor(105000, 5000, 5)).toBe(5000);
  });
  it('rounds to the paisa', () => {
    expect(agentCommissionMinor(33333, 0, 7.5)).toBe(2500); // 2499.975 → 2500
  });
  it('is zero for a zero rate or a zero net fare', () => {
    expect(agentCommissionMinor(100000, 0, 0)).toBe(0);
    expect(agentCommissionMinor(5000, 5000, 10)).toBe(0);
  });
  it('net cost is total minus commission', () => {
    expect(netCostMinor(105000, 5000)).toBe(100000);
  });
});

describe('agent account — funds check', () => {
  it('prepaid: must cover the net cost from balance alone', () => {
    expect(checkFunds({ balanceMinor: 100000, creditLimitMinor: 0, totalMinor: 105000, commissionMinor: 5000 }).ok).toBe(true);
    const short = checkFunds({ balanceMinor: 99999, creditLimitMinor: 0, totalMinor: 105000, commissionMinor: 5000 });
    expect(short).toEqual({ ok: false, shortfallMinor: 1 });
  });
  it('postpaid: may go negative down to the credit limit', () => {
    expect(spendableMinor(-40000, 50000)).toBe(10000);
    expect(checkFunds({ balanceMinor: -40000, creditLimitMinor: 50000, totalMinor: 10500, commissionMinor: 500 }).ok).toBe(true);
    expect(checkFunds({ balanceMinor: -40000, creditLimitMinor: 50000, totalMinor: 10600, commissionMinor: 500 }).ok).toBe(false);
  });
});

describe('agent account — refund clawback', () => {
  it('full refund reverses all commission', () => {
    expect(commissionClawbackMinor({ commissionCreditedMinor: 5000, refundMinor: 105000, paidMinor: 105000 })).toBe(5000);
  });
  it('partial refund reverses the same proportion', () => {
    expect(commissionClawbackMinor({ commissionCreditedMinor: 5000, refundMinor: 52500, paidMinor: 105000 })).toBe(2500);
  });
  it('never exceeds what was credited, never negative', () => {
    expect(commissionClawbackMinor({ commissionCreditedMinor: 5000, refundMinor: 200000, paidMinor: 105000 })).toBe(5000);
    expect(commissionClawbackMinor({ commissionCreditedMinor: 0, refundMinor: 1000, paidMinor: 1000 })).toBe(0);
    expect(commissionClawbackMinor({ commissionCreditedMinor: 5000, refundMinor: 0, paidMinor: 1000 })).toBe(0);
  });
});

describe('agent account — status & terms', () => {
  it('allows only the defined transitions', () => {
    expect(canTransition('pending', 'active')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
    expect(canTransition('active', 'suspended')).toBe(true);
    expect(canTransition('suspended', 'active')).toBe(true);
    expect(canTransition('rejected', 'active')).toBe(false);
    expect(canTransition('active', 'pending')).toBe(false);
  });
  it('prepaid agents cannot carry a credit limit', () => {
    expect(validateTerms({ billingMode: 'prepaid', creditLimitMinor: 1000 })).not.toBeNull();
    expect(validateTerms({ billingMode: 'prepaid', creditLimitMinor: 0 })).toBeNull();
  });
  it('a credit limit cannot be cut below what the agent already owes', () => {
    expect(validateTerms({ billingMode: 'postpaid', creditLimitMinor: 10000, balanceMinor: -20000 })).not.toBeNull();
    expect(validateTerms({ billingMode: 'postpaid', creditLimitMinor: 20000, balanceMinor: -20000 })).toBeNull();
  });
  it('low-balance alert only fires when a threshold is set', () => {
    expect(isLowBalance(500, 0, 1000)).toBe(true);
    expect(isLowBalance(500, 0, 0)).toBe(false);
    expect(isLowBalance(5000, 0, 1000)).toBe(false);
  });
});
