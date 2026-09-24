import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Operator application review — status machine + approval readiness
 * ============================================================================
 *
 *   pending ──approve──▶ approved   (terminal — a tenant is provisioned; later
 *      │                              control is tenant suspend/activate)
 *      ├──reject────▶ rejected ──reopen──▶ pending
 *      └──hold──────▶ pending   (stays pending, with a reason: "info requested")
 *
 * Every move except approve REQUIRES a reason (approve takes an optional
 * note). Only a super/platform admin moves an application. An approved
 * application can never go back — the operator already exists; reversing
 * that is a tenant suspension, which keeps the audit trail honest.
 */
export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type ReviewAction = 'approve' | 'reject' | 'hold' | 'reopen';

const ACTIONS: Record<
  ReviewAction,
  { from: ApplicationStatus[]; to: ApplicationStatus; reasonRequired: boolean }
> = {
  approve: { from: ['pending'], to: 'approved', reasonRequired: false },
  reject: { from: ['pending'], to: 'rejected', reasonRequired: true },
  hold: { from: ['pending'], to: 'pending', reasonRequired: true },
  reopen: { from: ['rejected'], to: 'pending', reasonRequired: true },
};

export function targetOf(action: ReviewAction): ApplicationStatus {
  return ACTIONS[action].to;
}

export function canReview(from: ApplicationStatus, action: ReviewAction): boolean {
  return ACTIONS[action].from.includes(from);
}

export function assertReview(
  from: ApplicationStatus,
  action: ReviewAction,
  reason?: string | null,
): void {
  if (!canReview(from, action)) {
    const hint =
      from === 'approved'
        ? 'This operator is already live — suspend the operator instead.'
        : `Allowed only from: ${ACTIONS[action].from.join(', ')}.`;
    throw new DomainError(
      ErrorCode.COMMON_CONFLICT,
      `Cannot ${action} an application that is '${from}'. ${hint}`,
      {
        details: { from, action },
      },
    );
  }
  const r = reason?.trim() ?? '';
  if (ACTIONS[action].reasonRequired && r.length < 10) {
    throw new DomainError(
      ErrorCode.COMMON_VALIDATION,
      `A reason of at least 10 characters is required to ${action} an application`,
    );
  }
  if (r.length > 1000) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Reason is too long (max 1000 characters)');
  }
}

export function isTerminal(status: ApplicationStatus): boolean {
  return status === 'approved';
}

/* ─── approval readiness (KYC / settlement pre-conditions) ─────────────── */

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface ApprovalCandidate {
  companyName?: string | null;
  email?: string | null;
  mobile?: string | null;
  gstNumber?: string | null;
  panNumber?: string | null;
  panVerificationStatus?: string | null;
  bankAccountHolder?: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
}

/**
 * Everything that must be true before an operator can go live on the GDS.
 * Returns human-readable blockers (empty = ready). Settlement needs bank
 * details; GST invoices need a valid GSTIN; the GSTIN must belong to the
 * same PAN (characters 3–12 of a GSTIN ARE the holder's PAN); a failed PAN
 * KYC is a hard stop.
 */
export function approvalBlockers(a: ApprovalCandidate): string[] {
  const out: string[] = [];
  const gst = a.gstNumber?.trim().toUpperCase() ?? '';
  const pan = a.panNumber?.trim().toUpperCase() ?? '';
  if (!a.companyName?.trim()) out.push('Company name is missing');
  if (!a.email?.trim()) out.push('Contact email is missing');
  if (!a.mobile?.trim()) out.push('Mobile number is missing');
  if (!gst) out.push('GSTIN is missing');
  else if (!GSTIN.test(gst)) out.push(`GSTIN '${gst}' is not in a valid format`);
  if (!pan) out.push('PAN is missing');
  else if (!PAN.test(pan)) out.push(`PAN '${pan}' is not in a valid format`);
  if (gst && pan && GSTIN.test(gst) && PAN.test(pan) && gst.slice(2, 12) !== pan) {
    out.push(`GSTIN ${gst} is not registered to PAN ${pan}`);
  }
  if (a.panVerificationStatus === 'failed')
    out.push('PAN verification failed — the PAN must pass KYC before approval');
  if (!a.bankAccountHolder?.trim() || !a.bankAccountNumber?.trim() || !a.bankIfsc?.trim()) {
    out.push('Bank account details are incomplete (needed for settlements)');
  } else {
    if (!IFSC.test(a.bankIfsc.trim().toUpperCase())) out.push(`IFSC '${a.bankIfsc}' is not valid`);
    if (!/^\d{9,18}$/.test(a.bankAccountNumber.trim()))
      out.push('Bank account number must be 9–18 digits');
  }
  return out;
}
