/**
 * ============================================================================
 *  Digio client — PAN match, Aadhaar OKYC (OTP), bank-account verification
 * ============================================================================
 *
 * Digio (digio.in) is a PAID Indian KYC-as-a-service provider — unlike
 * DigiLocker, there is no free tier for production use (new accounts get
 * a handful of free trial credits, not a permanent free allowance). This
 * client is built correctly and completely regardless; the cost is a
 * business decision for whoever runs this deployment, not a reason to
 * build the integration any less properly.
 *
 * AUTH: HTTP Basic, base64(client_id:client_secret) — issued when you
 * register for a Digio account (sandbox keys are free to obtain and use
 * against Digio's sandbox host; production keys require a paid plan).
 *
 * ENDPOINT PATHS: believed correct as of this writing but MUST be confirmed
 * against Digio's current API documentation (https://docs.digio.in) using
 * real sandbox credentials before any production use — KYC-vendor APIs
 * change their exact paths/payload shapes over time more often than core
 * banking rails do.
 */

export interface DigioConfig {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
}

function baseUrl(env: DigioConfig['environment']): string {
  return env === 'production' ? 'https://api.digio.in' : 'https://ext.digio.in:444';
}

function authHeader(config: DigioConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
}

async function digioFetch<T>(
  config: DigioConfig,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${baseUrl(config.environment)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(config) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Digio API error (${path}): ${response.status} ${text}`);
  }
  return JSON.parse(text) as T;
}

// ---- PAN ----

export interface PanVerificationResult {
  matched: boolean;
  nameAtPan: string | null;
  panStatus: string | null; // e.g. 'VALID' | 'INVALID' — Digio's own status string
}

/** Instant, synchronous — a genuine database match against the PAN, not just format validation. */
export async function verifyPan(
  config: DigioConfig,
  pan: string,
  nameToMatch?: string,
): Promise<PanVerificationResult> {
  const result = await digioFetch<{
    id_no: string;
    full_name?: string;
    pan_status?: string;
    status?: string;
  }>(config, '/v3/client/kyc/pan/verify', { id_no: pan.trim().toUpperCase(), name: nameToMatch });
  return {
    matched:
      (result.status ?? result.pan_status) === 'VALID' ||
      (result.status ?? '').toUpperCase() === 'ID_EXIST',
    nameAtPan: result.full_name ?? null,
    panStatus: result.pan_status ?? result.status ?? null,
  };
}

// ---- Aadhaar OKYC (OTP-based) ----

export interface AadhaarOtpSession {
  digioRequestId: string; // pass this back with the OTP on submit
}

/** Step 1 — sends an OTP to the mobile number linked to this Aadhaar (UIDAI-side, not ours). */
export async function generateAadhaarOtp(
  config: DigioConfig,
  aadhaarNumber: string,
): Promise<AadhaarOtpSession> {
  const result = await digioFetch<{ id: string }>(config, '/v2/client/kyc/aadhaar/generate_otp', {
    aadhaar_number: aadhaarNumber.replace(/\D/g, ''),
  });
  return { digioRequestId: result.id };
}

export interface AadhaarVerificationResult {
  verified: boolean;
  name: string | null;
  maskedAadhaar: string; // NEVER the full number — see maskAadhaar()
  dob: string | null;
  address: string | null;
}

/** Step 2 — the applicant's OTP, submitted back. Digio confirms it with UIDAI and returns the demographic record. */
export async function submitAadhaarOtp(
  config: DigioConfig,
  digioRequestId: string,
  otp: string,
): Promise<AadhaarVerificationResult> {
  const result = await digioFetch<{
    status: string;
    name?: string;
    dob?: string;
    address?: string;
    aadhaar_number?: string;
  }>(config, '/v2/client/kyc/aadhaar/submit_otp', { id: digioRequestId, otp });

  return {
    verified: result.status === 'success' || result.status === 'ID_VERIFIED',
    name: result.name ?? null,
    maskedAadhaar: maskAadhaar(result.aadhaar_number ?? ''),
    dob: result.dob ?? null,
    address: result.address ?? null,
  };
}

// ---- Bank account verification (penny-drop / account-aggregator-backed) ----

export interface BankAccountVerificationResult {
  verified: boolean;
  nameAtBank: string | null;
  utr: string | null; // the penny-drop transaction reference, for audit
  failureReason: string | null;
}

/** Synchronous — Digio drops (and typically reverses) a token amount into the account and confirms it landed, returning the registered account-holder name for the caller to compare against the applicant's stated name. */
export async function verifyBankAccount(
  config: DigioConfig,
  accountNumber: string,
  ifsc: string,
): Promise<BankAccountVerificationResult> {
  const result = await digioFetch<{
    status: string;
    name_at_bank?: string;
    utr?: string;
    message?: string;
  }>(config, '/v3/client/bank_verification', {
    id_no: accountNumber.trim(),
    ifsc: ifsc.trim().toUpperCase(),
  });
  return {
    verified: result.status === 'success' || result.status === 'ACCOUNT_EXISTS',
    nameAtBank: result.name_at_bank ?? null,
    utr: result.utr ?? null,
    failureReason:
      result.status === 'success' ? null : (result.message ?? 'Bank account could not be verified'),
  };
}

/** Never store or return more than this — see the compliance note in the migration and KycService's own doc comment. */
export function maskAadhaar(fullNumber: string): string {
  const digitsOnly = fullNumber.replace(/\D/g, '');
  if (digitsOnly.length !== 12) return 'XXXX XXXX XXXX';
  return `XXXX XXXX ${digitsOnly.slice(-4)}`;
}

export function maskAccountNumber(accountNumber: string): string {
  const clean = accountNumber.trim();
  if (clean.length <= 4) return clean;
  return `${'X'.repeat(clean.length - 4)}${clean.slice(-4)}`;
}
