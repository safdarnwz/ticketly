import { describe, it, expect } from 'vitest';

import {
  validateTestInstrument, maskCard, luhnValid, cardBrand, expiryInFuture,
  type TestGatewayConfig,
} from '../test-gateway';

const CONFIG: TestGatewayConfig = {
  upiSuccessVpa: 'success@ticketly',
  upiFailureVpa: 'failure@ticketly',
  cardSuccessNumber: '4111111111111111', // Visa test PAN, Luhn-valid
  cardFailureNumber: '4000000000000002',
  cardCvv: '123',
  cardExpiry: '12/30',
  netbankingUser: 'ticketly',
  netbankingPassword: 'test1234',
  netbankingBanks: ['HDFC', 'ICICI', 'SBI', 'AXIS', 'KOTAK'],
};

const NOW = { year: 2026, month: 8 };

describe('luhnValid', () => {
  it('happy: a valid Visa test PAN passes', () => {
    expect(luhnValid('4111 1111 1111 1111')).toBe(true);
  });
  it('negative: a mistyped PAN fails', () => {
    expect(luhnValid('4111111111111112')).toBe(false);
  });
  it('edge: too-short input fails rather than throwing', () => {
    expect(luhnValid('411')).toBe(false);
    expect(luhnValid('')).toBe(false);
  });
});

describe('maskCard / cardBrand', () => {
  it('happy: masks all but the last four', () => {
    expect(maskCard('4111111111111111')).toBe('•••• •••• •••• 1111');
  });
  it('positive: detects common brands from the IIN', () => {
    expect(cardBrand('4111111111111111')).toBe('Visa');
    expect(cardBrand('5555555555554444')).toBe('Mastercard');
    expect(cardBrand('6011000000000004')).toBe('RuPay');
  });
});

describe('expiryInFuture', () => {
  it('happy: a later year is in the future', () => {
    expect(expiryInFuture('12/30', NOW)).toBe(true);
  });
  it('edge: the current month is still valid', () => {
    expect(expiryInFuture('08/26', NOW)).toBe(true);
  });
  it('negative: a past month is expired', () => {
    expect(expiryInFuture('07/26', NOW)).toBe(false);
  });
  it('negative: garbage / month 13 is rejected', () => {
    expect(expiryInFuture('13/30', NOW)).toBe(false);
    expect(expiryInFuture('not-a-date', NOW)).toBe(false);
  });
});

describe('validateTestInstrument — UPI', () => {
  it('happy: the success VPA is accepted and echoed as the masked ref', () => {
    const r = validateTestInstrument({ method: 'upi', vpa: 'success@ticketly' }, CONFIG, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.masked).toBe('success@ticketly');
  });
  it('positive: VPA match is case-insensitive', () => {
    expect(validateTestInstrument({ method: 'upi', vpa: 'SUCCESS@Ticketly' }, CONFIG, NOW).ok).toBe(true);
  });
  it('negative: the failure VPA is declined', () => {
    const r = validateTestInstrument({ method: 'upi', vpa: 'failure@ticketly' }, CONFIG, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/declined/i);
  });
  it('negative: an unknown VPA is not authorised', () => {
    expect(validateTestInstrument({ method: 'upi', vpa: 'random@okaxis' }, CONFIG, NOW).ok).toBe(false);
  });
  it('edge: a malformed VPA is rejected before matching', () => {
    expect(validateTestInstrument({ method: 'upi', vpa: 'not-a-vpa' }, CONFIG, NOW).ok).toBe(false);
    expect(validateTestInstrument({ method: 'upi', vpa: '' }, CONFIG, NOW).ok).toBe(false);
  });
});

describe('validateTestInstrument — cards', () => {
  it('happy: the success card with right expiry+cvv is captured', () => {
    const r = validateTestInstrument({ method: 'credit_card', cardNumber: '4111 1111 1111 1111', expiry: '12/30', cvv: '123' }, CONFIG, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.masked).toBe('•••• •••• •••• 1111'); expect(r.label).toBe('Visa credit card'); }
  });
  it('positive: a debit card gets a debit label', () => {
    const r = validateTestInstrument({ method: 'debit_card', cardNumber: '4111111111111111', expiry: '12/30', cvv: '123' }, CONFIG, NOW);
    expect(r.ok && r.label).toBe('Visa debit card');
  });
  it('negative: the designated failure card is declined by the "bank"', () => {
    const r = validateTestInstrument({ method: 'credit_card', cardNumber: '4000000000000002', expiry: '12/30', cvv: '123' }, CONFIG, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/declined/i);
  });
  it('negative: an unknown (but Luhn-valid) card is not authorised', () => {
    // 4242…4242 is Luhn-valid but not our configured success/failure card.
    expect(validateTestInstrument({ method: 'credit_card', cardNumber: '4242424242424242', expiry: '12/30', cvv: '123' }, CONFIG, NOW).ok).toBe(false);
  });
  it('negative: wrong CVV is rejected', () => {
    expect(validateTestInstrument({ method: 'credit_card', cardNumber: '4111111111111111', expiry: '12/30', cvv: '999' }, CONFIG, NOW).ok).toBe(false);
  });
  it('negative: an expired card is rejected', () => {
    expect(validateTestInstrument({ method: 'credit_card', cardNumber: '4111111111111111', expiry: '01/20', cvv: '123' }, CONFIG, NOW).ok).toBe(false);
  });
  it('edge: a Luhn-invalid PAN is a client error, not a decline', () => {
    const r = validateTestInstrument({ method: 'credit_card', cardNumber: '4111111111111112', expiry: '12/30', cvv: '123' }, CONFIG, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid card/i);
  });
});

describe('validateTestInstrument — net-banking', () => {
  it('happy: a supported bank with right login is captured', () => {
    const r = validateTestInstrument({ method: 'net_banking', bank: 'HDFC', username: 'ticketly', password: 'test1234' }, CONFIG, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label).toBe('HDFC net-banking');
  });
  it('negative: an unsupported bank is rejected', () => {
    expect(validateTestInstrument({ method: 'net_banking', bank: 'UNKNOWN', username: 'ticketly', password: 'test1234' }, CONFIG, NOW).ok).toBe(false);
  });
  it('negative: a wrong password fails the login', () => {
    const r = validateTestInstrument({ method: 'net_banking', bank: 'ICICI', username: 'ticketly', password: 'wrong' }, CONFIG, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/login failed/i);
  });
});
