import { createHash, randomUUID } from 'crypto';
import {
  BankVerificationProvider, BankVerificationResult, BureauReport, CkycProvider, CkycResult, CreditBureauProvider,
  EsignCompleteResult, EsignInitResult, EsignProvider, PanKycProvider, PanVerificationResult, PayoutProvider,
  PayoutResult, ReconciliationEntry, ReconciliationProvider,
} from '../ports';

/**
 * Deterministic simulators. NO real KYC, bureau pull, e-sign or money movement happens.
 * Test data rules (see README):
 *   PAN last letter 'Z'                 → PAN invalid
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

export class SandboxPanKyc implements PanKycProvider {
  constructor(private readonly l: SandboxLatency) {}
  async verifyPan(pan: string, name: string): Promise<PanVerificationResult> {
    await this.l.wait();
    const ok = !pan.endsWith('Z');
    return { valid: ok, panStatus: ok ? 'VALID' : 'INVALID', nameOnPan: ok ? name.toUpperCase() : null, aadhaarSeeded: ok, ref: ref('pan') };
  }
}

export class SandboxCkyc implements CkycProvider {
  constructor(private readonly l: SandboxLatency) {}
  async searchAndDownload(pan: string, dob: string): Promise<CkycResult> {
    await this.l.wait();
    const n = createHash('sha256').update(pan).digest('hex').replace(/\D/g, '').slice(0, 14).padEnd(14, '0');
    return { found: true, ckycNumber: n, fullName: null, dob, ref: ref('ckyc') };
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

export class SandboxEsign implements EsignProvider {
  private readonly requests = new Map<string, { hash: string; name: string }>();
  constructor(private readonly l: SandboxLatency) {}
  async initiate(input: { documentHash: string; signerName: string }): Promise<EsignInitResult> {
    await this.l.wait();
    const id = ref('esign');
    this.requests.set(id, { hash: input.documentHash, name: input.signerName });
    return { requestId: id, signingUrl: null };
  }
  async complete(requestId: string, otp: string): Promise<EsignCompleteResult> {
    await this.l.wait();
    const r = this.requests.get(requestId);
    if (!r || otp !== '123456') return { signed: false, signedDocumentRef: null, signerName: null };
    this.requests.delete(requestId);
    return { signed: true, signedDocumentRef: `signed/${requestId}/${r.hash.slice(0, 12)}.pdf`, signerName: r.name };
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
