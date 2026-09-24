/**
 * ============================================================================
 *  Test payment gateway — pure instrument validation & masking
 * ============================================================================
 *
 *  A SANDBOX gateway for QA / demos ONLY. It lets the whole payment flow run
 *  end-to-end (choose a method → enter test credentials → booking confirmed →
 *  ledger posted) with NO real PSP. It is gated behind `PAYMENT_TEST_MODE` and
 *  is meant to be removed the moment a real PSP (Razorpay/PayU/…) is wired in.
 *
 *  This file is PURE (no I/O): it validates a submitted payment instrument
 *  (UPI / credit-card / debit-card / net-banking) against the configured test
 *  credentials and produces a MASKED reference to persist. Because it is pure,
 *  every branch — success VPA, decline VPA, wrong card, expired card, bad CVV,
 *  unknown bank, wrong net-banking login — is exhaustively unit-testable.
 *
 *  SECURITY NOTE: this never validates a REAL instrument and never talks to a
 *  bank. It only compares against values an operator explicitly placed in the
 *  environment for testing. Full PANs are never stored — only a masked form.
 */

export type PaymentMethod = 'upi' | 'credit_card' | 'debit_card' | 'net_banking';

/** The configured test credentials (from env, via AppConfig.payment.test). */
export interface TestGatewayConfig {
  /** UPI VPA that should SUCCEED (e.g. "success@ticketly"). */
  upiSuccessVpa: string;
  /** UPI VPA that should be DECLINED — for negative testing (e.g. "failure@ticketly"). */
  upiFailureVpa: string;
  /** Card number that should SUCCEED (digits only). */
  cardSuccessNumber: string;
  /** Card number that should be DECLINED — for negative testing. */
  cardFailureNumber: string;
  /** The only CVV that is accepted for the success card. */
  cardCvv: string;
  /** Expiry accepted for the success card, "MM/YY". */
  cardExpiry: string;
  /** Net-banking username accepted. */
  netbankingUser: string;
  /** Net-banking password accepted. */
  netbankingPassword: string;
  /** Banks offered for net-banking (codes/names). */
  netbankingBanks: string[];
}

/** A submitted instrument, discriminated by method. */
export type TestInstrument =
  | { method: 'upi'; vpa: string }
  | {
      method: 'credit_card' | 'debit_card';
      cardNumber: string;
      expiry: string;
      cvv: string;
      holder?: string;
    }
  | { method: 'net_banking'; bank: string; username: string; password: string };

export interface ValidationOk {
  ok: true;
  /** Safe-to-store masked reference, e.g. "•••• •••• •••• 1111" or "success@ticketly". */
  masked: string;
  /** Human brand/instrument label for receipts, e.g. "Visa credit card", "HDFC net-banking". */
  label: string;
}
export interface ValidationFail {
  ok: false;
  /** A gateway-style decline reason shown to the user. */
  reason: string;
}
export type ValidationResult = ValidationOk | ValidationFail;

const digitsOnly = (s: string): string => (s ?? '').replace(/\D/g, '');

/** Mask a card PAN to reveal only the last four: "•••• •••• •••• 1111". */
export function maskCard(cardNumber: string): string {
  const d = digitsOnly(cardNumber);
  const last4 = d.slice(-4).padStart(4, '•');
  return `•••• •••• •••• ${last4}`;
}

/**
 * Luhn check — a real gateway rejects PANs that fail it, so we mirror that as
 * an EDGE guard even in the sandbox (a mistyped card number is a client error,
 * not a decline). Kept pure and tiny.
 */
export function luhnValid(cardNumber: string): boolean {
  const d = digitsOnly(cardNumber);
  if (d.length < 12) return false;
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Guess a card brand from its IIN (issuer id) — for a real-looking label. */
export function cardBrand(cardNumber: string): string {
  const d = digitsOnly(cardNumber);
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^(60|65|81|508)/.test(d)) return 'RuPay';
  return 'Card';
}

/**
 * Is "MM/YY" (or "MM/YYYY") in the future, relative to a supplied "now"?
 * `now` is injected so the function stays pure and deterministic in tests.
 */
export function expiryInFuture(expiry: string, now: { year: number; month: number }): boolean {
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec((expiry ?? '').trim());
  if (!m) return false;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return false;
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  // Card is valid through the END of its expiry month.
  if (year > now.year) return true;
  if (year < now.year) return false;
  return month >= now.month;
}

/**
 * Validate a submitted test instrument against the configured credentials.
 * `now` (current year/month) is injected for deterministic expiry checks.
 */
export function validateTestInstrument(
  instrument: TestInstrument,
  config: TestGatewayConfig,
  now: { year: number; month: number },
): ValidationResult {
  switch (instrument.method) {
    case 'upi': {
      const vpa = (instrument.vpa ?? '').trim().toLowerCase();
      if (!vpa || !/^[a-z0-9._-]+@[a-z0-9._-]+$/.test(vpa)) {
        return { ok: false, reason: 'Enter a valid UPI ID (e.g. name@bank).' };
      }
      if (vpa === config.upiFailureVpa.trim().toLowerCase()) {
        return { ok: false, reason: 'Payment declined by the UPI app. Please try another method.' };
      }
      if (vpa !== config.upiSuccessVpa.trim().toLowerCase()) {
        return { ok: false, reason: 'This UPI ID is not authorised in test mode.' };
      }
      return { ok: true, masked: vpa, label: 'UPI' };
    }

    case 'credit_card':
    case 'debit_card': {
      const pan = digitsOnly(instrument.cardNumber);
      if (!luhnValid(pan)) {
        return { ok: false, reason: 'Invalid card number. Check the digits and try again.' };
      }
      if (pan === digitsOnly(config.cardFailureNumber)) {
        return { ok: false, reason: 'Card declined by the issuing bank.' };
      }
      if (pan !== digitsOnly(config.cardSuccessNumber)) {
        return { ok: false, reason: 'This card is not authorised in test mode.' };
      }
      if (!expiryInFuture(instrument.expiry, now)) {
        return { ok: false, reason: 'Card has expired or the expiry date is invalid.' };
      }
      if (digitsOnly(instrument.cvv) !== digitsOnly(config.cardCvv)) {
        return { ok: false, reason: 'Incorrect CVV.' };
      }
      const kind = instrument.method === 'credit_card' ? 'credit card' : 'debit card';
      return { ok: true, masked: maskCard(pan), label: `${cardBrand(pan)} ${kind}` };
    }

    case 'net_banking': {
      const bank = (instrument.bank ?? '').trim();
      const banks = config.netbankingBanks.map((b) => b.trim().toLowerCase());
      if (!bank || !banks.includes(bank.toLowerCase())) {
        return { ok: false, reason: 'Please choose a supported bank.' };
      }
      if (
        (instrument.username ?? '').trim() !== config.netbankingUser.trim() ||
        (instrument.password ?? '') !== config.netbankingPassword
      ) {
        return { ok: false, reason: 'Net-banking login failed. Check your credentials.' };
      }
      return { ok: true, masked: `${bank} net-banking`, label: `${bank} net-banking` };
    }

    default:
      return { ok: false, reason: 'Unsupported payment method.' };
  }
}

/** The methods this sandbox supports, for the client to render options. */
export const TEST_PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'debit_card', label: 'Debit Card' },
  { value: 'net_banking', label: 'Net Banking' },
];
