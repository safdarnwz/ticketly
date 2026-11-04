/**
 * Provider-agnostic ports for every external integration in the instant journey.
 * Sandbox adapters implement them for development and tests; live adapters are written per
 * signed vendor contract and selected with INTEGRATIONS_MODE=live.
 */

// PAN / KYC API — customer verification
export interface PanVerificationResult {
  valid: boolean;
  nameOnPan: string | null;
  panStatus: 'VALID' | 'INVALID' | 'NOT_FOUND';
  aadhaarSeeded: boolean;
  ref: string;
}
export interface PanKycProvider {
  verifyPan(pan: string, name: string, dob: string): Promise<PanVerificationResult>;
}

// CKYC / permitted KYC provider — KYC compliance
export interface CkycResult {
  found: boolean;
  ckycNumber: string | null;
  fullName: string | null;
  dob: string | null;
  ref: string;
}
export interface CkycProvider {
  searchAndDownload(pan: string, dob: string, consentRef: string): Promise<CkycResult>;
}

// Credit Bureau API — credit history
export interface BureauReport {
  score: number | null; // null = new to credit
  maxDpdLast12m: number;
  writtenOffOrSettled: boolean;
  activeLoans: number;
  totalEmiPaise: number;
  enquiriesLast30d: number;
  reportRef: string;
}
export interface CreditBureauProvider {
  pullReport(input: { pan: string; name: string; dob: string; mobile: string; consentRef: string }): Promise<BureauReport>;
}

// Bank verification / penny drop — account ownership & beneficiary validation
export interface BankVerificationResult {
  accountExists: boolean;
  accountActive: boolean;
  registeredName: string | null;
  ref: string;
}
export interface BankVerificationProvider {
  /** `expectedName` lets providers that support it return a name-match score as well. */
  validateAccount(accountNumber: string, ifsc: string, expectedName: string): Promise<BankVerificationResult>;
}

// eSign / digital signature — loan agreement
export interface EsignInitResult {
  requestId: string;
  /** Hosted signing page (Aadhaar eSign). Sandbox completes with an OTP instead. */
  signingUrl: string | null;
}
export interface EsignCompleteResult {
  signed: boolean;
  signedDocumentRef: string | null;
  signerName: string | null;
}
export interface EsignProvider {
  initiate(input: { documentHash: string; signerName: string; mobile: string }): Promise<EsignInitResult>;
  complete(requestId: string, otp: string): Promise<EsignCompleteResult>;
}

// UPI / IMPS / NEFT payout API — instant digital disbursement
export type PayoutState = 'PENDING' | 'SUCCESS' | 'FAILED';
export interface PayoutResult {
  providerRef: string;
  state: PayoutState;
  utr: string | null;
  failureCode: string | null;
  /** true if the failure is a bank/network problem and another rail may succeed. */
  retryable: boolean;
}
export interface PayoutProvider {
  /** Must be idempotent on `idempotencyKey`: a repeat call returns the original payout. */
  initiate(input: {
    idempotencyKey: string;
    amountPaise: number;
    rail: 'IMPS' | 'UPI' | 'NEFT';
    accountNumber: string;
    ifsc: string;
    beneficiaryName: string;
    narration: string;
  }): Promise<PayoutResult>;
  status(providerRef: string): Promise<PayoutResult>;
}

// Payment reconciliation API — transaction confirmation
export interface ReconciliationEntry {
  providerRef: string;
  utr: string;
  amountPaise: number;
  valueDate: string;
}
export interface ReconciliationProvider {
  settledPayouts(sinceIso: string): Promise<ReconciliationEntry[]>;
}

export const PAN_KYC = Symbol('PAN_KYC');
export const CKYC = Symbol('CKYC');
export const CREDIT_BUREAU = Symbol('CREDIT_BUREAU');
export const BANK_VERIFICATION = Symbol('BANK_VERIFICATION');
export const ESIGN = Symbol('ESIGN');
export const PAYOUT = Symbol('PAYOUT');
export const RECONCILIATION = Symbol('RECONCILIATION');
