import { createHash, randomUUID } from 'crypto';
import {
  BankVerificationProvider, BankVerificationResult, BureauReport, CreditBureauProvider, EkycProvider, EkycResult, EkycSession,
  EsignInitResult, EsignProvider, EsignStatus, NotificationProvider, PaymentGatewayProvider, PaymentOrder, PaymentStatus,
  PayoutProvider, PayoutResult, ReconciliationEntry, ReconciliationProvider,
} from '../ports';

/**
 * Deterministic simulators. NO real KYC, bureau pull, e-sign or money movement happens.
 * Test data rules (see README). In sandbox the tester types the PAN / name / DOB that DigiLocker
 * would have returned:
 *   PAN last letter 'Z'                 → eKYC rejected
 *   PAN digits 0001–5999               → bureau score 760 (auto approve)
 *   PAN digits 6000–6999               → bureau score 680 (manual review)
 *   PAN digits 7000–7999               → bureau score 600 (reject)
 *   PAN digits 8000–8999               → written-off account (reject)
 *   PAN digits 9000–9999               → new to credit (manual review)
 *   Account ending 0000                → account does not exist
 *   Account ending 1111                → holder name differs from KYC name
 *   Account ending 2222                → IMPS fails (bank offline), NEFT fallback succeeds
 *   Account ending 3333                → payout fails, account closed (no retry)
 *   e-sign OTP                         → 123456
 *   Payments                           → paid from the sandbox payment page
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ref = (p: string) => `${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const panDigits = (pan: string) => Number(pan.slice(5, 9));

export class SandboxLatency {
  constructor(private readonly baseMs: number) {}
  wait(factor = 1) {
    return sleep(Math.round(this.baseMs * factor * (0.5 + Math.random())));
  }
}

/** Simulates Digio DigiKYC. `simulate()` plays the part of the customer finishing DigiLocker. */
export class SandboxEkyc implements EkycProvider {
  private readonly requests = new Map<string, EkycResult>();
  constructor(private readonly l: SandboxLatency) {}
  async start(input: { mobile: string }): Promise<EkycSession> {
    await this.l.wait();
    const id = ref('KID');
    this.requests.set(id, { state: 'PENDING', name: null, dob: null, pan: null, nameOnPan: null, aadhaarLast4: null, ref: id });
    return { requestId: id, accessTokenId: ref('GWT'), customerIdentifier: input.mobile };
  }
  simulate(requestId: string, d: { pan: string; fullName: string; dateOfBirth: string }) {
    const r = this.requests.get(requestId);
    if (!r || r.state !== 'PENDING') return false;
    if (d.pan.endsWith('Z')) this.requests.set(requestId, { ...r, state: 'REJECTED' });
    else this.requests.set(requestId, { ...r, state: 'APPROVED', name: d.fullName.toUpperCase(), nameOnPan: d.fullName.toUpperCase(), dob: d.dateOfBirth, pan: d.pan, aadhaarLast4: String(panDigits(d.pan)).padStart(4, '0') });
    return true;
  }
  async result(requestId: string): Promise<EkycResult> {
    await this.l.wait();
    return this.requests.get(requestId) ?? { state: 'EXPIRED', name: null, dob: null, pan: null, nameOnPan: null, aadhaarLast4: null, ref: requestId };
  }
}

export class SandboxBureau implements CreditBureauProvider {
  constructor(private readonly l: SandboxLatency) {}
  async pullReport(input: { pan: string }): Promise<BureauReport> {
    await this.l.wait(2);
    const d = panDigits(input.pan);
    const base: BureauReport = { score: 760, maxDpdLast12m: 0, writtenOffOrSettled: false, activeLoans: 1, totalEmiPaise: 300_000, enquiriesLast30d: 1, reportRef: ref('cir') };
    if (d >= 9000) return { ...base, score: null, activeLoans: 0, totalEmiPaise: 0 };
    if (d >= 8000) return { ...base, score: 640, writtenOffOrSettled: true, maxDpdLast12m: 120 };
    if (d >= 7000) return { ...base, score: 600, maxDpdLast12m: 30 };
    if (d >= 6000) return { ...base, score: 680 };
    return base;
  }
}

export class SandboxBankVerification implements BankVerificationProvider {
  constructor(private readonly l: SandboxLatency) {}
  async validateAccount(accountNumber: string, _ifsc: string, expectedName: string): Promise<BankVerificationResult> {
    await this.l.wait(2);
    if (accountNumber.endsWith('0000')) return { accountExists: false, accountActive: false, registeredName: null, ref: ref('pd') };
    const name = accountNumber.endsWith('1111') ? 'ANOTHER PERSON' : expectedName.toUpperCase();
    return { accountExists: true, accountActive: true, registeredName: name, ref: ref('pd') };
  }
}

/** Simulates Digio Aadhaar eSign. `simulate()` is the customer entering the Aadhaar OTP. */
export class SandboxEsign implements EsignProvider {
  private readonly requests = new Map<string, { name: string; signed: boolean }>();
  constructor(private readonly l: SandboxLatency) {}
  async initiate(input: { signerName: string }): Promise<EsignInitResult> {
    await this.l.wait();
    const id = ref('DID');
    this.requests.set(id, { name: input.signerName, signed: false });
    return { requestId: id, accessTokenId: ref('GWT') };
  }
  simulate(requestId: string, otp: string) {
    const r = this.requests.get(requestId);
    if (!r || otp !== '123456') return false;
    r.signed = true;
    return true;
  }
  async status(requestId: string): Promise<EsignStatus> {
    await this.l.wait();
    const r = this.requests.get(requestId);
    return { signed: !!r?.signed, failed: !r, signerName: r?.name ?? null };
  }
}

/** Simulates a payment gateway (UPI / net banking / card). `simulate()` is the customer paying. */
export class SandboxPayments implements PaymentGatewayProvider {
  private readonly orders = new Map<string, PaymentStatus & { reference: string; amountPaise: number }>();
  private readonly byRef = new Map<string, string>();
  constructor(private readonly l: SandboxLatency, private readonly webUrl: string) {}
  async createOrder(input: { reference: string; amountPaise: number }): Promise<PaymentOrder> {
    const existing = this.byRef.get(input.reference);
    const id = existing ?? ref('order');
    if (!existing) {
      await this.l.wait();
      this.orders.set(id, { orderId: id, reference: input.reference, amountPaise: input.amountPaise, state: 'PENDING', paidPaise: 0, method: null, utr: null, paidAt: null });
      this.byRef.set(input.reference, id);
    }
    return { orderId: id, paymentUrl: `${this.webUrl}/#sandbox-pay/${id}`, upiIntentUrl: `upi://pay?pa=lender@sandbox&am=${(input.amountPaise / 100).toFixed(2)}&tr=${id}` };
  }
  simulate(orderId: string, outcome: 'PAID' | 'FAILED', method = 'UPI') {
    const o = this.orders.get(orderId);
    if (!o || o.state !== 'PENDING') return null;
    Object.assign(o, outcome === 'PAID'
      ? { state: 'PAID', paidPaise: o.amountPaise, method, utr: String(Math.floor(1e11 + Math.random() * 9e11)), paidAt: new Date().toISOString() }
      : { state: 'FAILED', method });
    return { orderId, amountPaise: o.amountPaise };
  }
  order(orderId: string) {
    return this.orders.get(orderId) ?? null;
  }
  async status(orderId: string): Promise<PaymentStatus> {
    const o = this.orders.get(orderId);
    if (!o) return { orderId, state: 'EXPIRED', paidPaise: 0, method: null, utr: null, paidAt: null };
    const { reference: _r, amountPaise: _a, ...st } = o;
    return { ...st };
  }
}

/** Sandbox SMS: keeps sent messages in memory so tests and the demo can show them. */
export class SandboxSms implements NotificationProvider {
  readonly sent: { mobile: string; templateKey: string; vars: Record<string, string>; at: string }[] = [];
  async sms(mobile: string, templateKey: string, vars: Record<string, string>) {
    this.sent.push({ mobile, templateKey, vars, at: new Date().toISOString() });
    if (this.sent.length > 500) this.sent.shift();
    return { ref: ref('sms') };
  }
}

interface SandboxPayout { result: PayoutResult; amountPaise: number; settleAt: number }

export class SandboxPayouts implements PayoutProvider, ReconciliationProvider {
  private readonly byKey = new Map<string, SandboxPayout>();
  private readonly byRef = new Map<string, SandboxPayout>();
  constructor(private readonly l: SandboxLatency, private readonly settleMs: number) {}

  async initiate(input: Parameters<PayoutProvider['initiate']>[0]): Promise<PayoutResult> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return { ...existing.result };
    await this.l.wait();
    const p: SandboxPayout = {
      amountPaise: input.amountPaise,
      settleAt: Date.now() + this.settleMs,
      result: { providerRef: ref('pout'), state: 'PENDING', utr: null, failureCode: null, retryable: false },
    };
    if (input.accountNumber.endsWith('3333')) p.result = { ...p.result, state: 'FAILED', failureCode: 'ACCOUNT_CLOSED' };
    else if (input.accountNumber.endsWith('2222') && input.rail === 'IMPS')
      p.result = { ...p.result, state: 'FAILED', failureCode: 'BENEFICIARY_BANK_OFFLINE', retryable: true };
    this.byKey.set(input.idempotencyKey, p);
    this.byRef.set(p.result.providerRef, p);
    return { ...p.result };
  }

  async status(providerRef: string): Promise<PayoutResult> {
    const p = this.byRef.get(providerRef);
    if (!p) return { providerRef, state: 'FAILED', utr: null, failureCode: 'UNKNOWN_REFERENCE', retryable: false };
    if (p.result.state === 'PENDING' && Date.now() >= p.settleAt) {
      p.result = { ...p.result, state: 'SUCCESS', utr: String(Math.floor(1e11 + Math.random() * 9e11)) };
    }
    return { ...p.result };
  }

  async settledPayouts(): Promise<ReconciliationEntry[]> {
    return [...this.byRef.values()]
      .filter((p) => p.result.state === 'SUCCESS' && p.result.utr)
      .map((p) => ({ providerRef: p.result.providerRef, utr: p.result.utr!, amountPaise: p.amountPaise, valueDate: new Date().toISOString().slice(0, 10) }));
  }
}
