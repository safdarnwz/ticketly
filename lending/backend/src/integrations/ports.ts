/**
 * Provider-agnostic ports for every external integration in the instant journey.
 * Sandbox adapters implement them for development and tests; live adapters are written per
 * signed vendor contract and selected with INTEGRATIONS_MODE=live.
 */

// eKYC (Digio DigiKYC: DigiLocker Aadhaar + PAN) — customer verification
// Asynchronous: we create a request, the customer completes it in the provider's SDK,
// then we read the verified result from the provider (webhook or SDK callback).
export type EkycState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export interface EkycSession {
  requestId: string;
  /** One-time token for the provider's Web SDK. */
  accessTokenId: string | null;
  customerIdentifier: string;
}
export interface EkycResult {
  state: EkycState;
  /** Name and DOB as on Aadhaar. */
  name: string | null;
  dob: string | null; // YYYY-MM-DD
  pan: string | null;
  nameOnPan: string | null;
  aadhaarLast4: string | null;
  ref: string;
}
export interface EkycProvider {
  start(input: { mobile: string; referenceId: string }): Promise<EkycSession>;
  result(requestId: string): Promise<EkycResult>;
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

// eSign (Digio Aadhaar eSign) — loan agreement
export interface EsignInitResult {
  requestId: string;
  accessTokenId: string | null;
}
export interface EsignStatus {
  signed: boolean;
  failed: boolean;
  signerName: string | null;
}
export interface EsignProvider {
  initiate(input: { pdfBase64: string; fileName: string; signerName: string; mobile: string; referenceId: string }): Promise<EsignInitResult>;
  status(requestId: string): Promise<EsignStatus>;
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

// Repayment payment gateway — UPI (intent / QR), net banking, debit card. No eNACH mandate.
export type PaymentState = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
export interface PaymentOrder {
  orderId: string;
  paymentUrl: string;
  upiIntentUrl: string | null;
}
export interface PaymentStatus {
  orderId: string;
  state: PaymentState;
  paidPaise: number;
  method: string | null;
  utr: string | null;
  paidAt: string | null;
}
export interface PaymentGatewayProvider {
  /** Must be idempotent on `reference`. Money settles to the lender's own account. */
  createOrder(input: { reference: string; amountPaise: number; mobile: string; name: string; description: string; expiresInMinutes: number }): Promise<PaymentOrder>;
  status(orderId: string): Promise<PaymentStatus>;
}

// SMS (DLT-registered templates) — reminders and receipts
export interface NotificationProvider {
  sms(mobile: string, templateKey: string, vars: Record<string, string>): Promise<{ ref: string }>;
}

export const EKYC = Symbol('EKYC');
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
export const NOTIFY = Symbol('NOTIFY');
export const CREDIT_BUREAU = Symbol('CREDIT_BUREAU');
export const BANK_VERIFICATION = Symbol('BANK_VERIFICATION');
export const ESIGN = Symbol('ESIGN');
export const PAYOUT = Symbol('PAYOUT');
export const RECONCILIATION = Symbol('RECONCILIATION');
