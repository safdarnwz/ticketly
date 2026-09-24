/**
 * ============================================================================
 *  Bus verification — pure domain rules
 * ============================================================================
 *
 * A bus is only sellable once the PLATFORM has checked its papers. The rules
 * here are pure (no I/O) so every edge case is unit-tested:
 *
 *   - Indian registration number format (standard + BH series), normalised.
 *   - The set of documents every bus must carry (Motor Vehicles Act 1988).
 *   - Compliance: each required document must have a VERIFIED, UNEXPIRED
 *     version. A pending renewal never removes compliance the old verified
 *     one still provides; an expired one does, immediately.
 *   - The verification status machine, split into what the OPERATOR may do
 *     and what only the SUPER ADMIN may do.
 */

export type VerificationStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'suspended';
export type DocVerification = 'pending' | 'verified' | 'rejected';

export const REQUIRED_DOC_TYPES = [
  'rc',
  'insurance',
  'permit',
  'fitness',
  'puc',
  'road_tax',
] as const;
export type RequiredDocType = (typeof REQUIRED_DOC_TYPES)[number];
/** Optional extras an operator may upload; never block approval. */
export const OPTIONAL_DOC_TYPES = [
  'passenger_insurance',
  'speed_governor',
  'fire_safety',
  'gps_certificate',
  'photo_front',
  'photo_side',
  'photo_interior',
] as const;
export const ALL_DOC_TYPES: readonly string[] = [...REQUIRED_DOC_TYPES, ...OPTIONAL_DOC_TYPES];

export const DOC_LABELS: Record<string, string> = {
  rc: 'Registration Certificate (RC)',
  insurance: 'Insurance',
  permit: 'Permit',
  fitness: 'Fitness Certificate',
  puc: 'Pollution Under Control (PUC)',
  road_tax: 'Road Tax Receipt',
  passenger_insurance: 'Passenger Insurance',
  speed_governor: 'Speed Governor Certificate',
  fire_safety: 'Fire Safety Certificate',
  gps_certificate: 'GPS / VLTD Certificate',
  photo_front: 'Photo — front',
  photo_side: 'Photo — side',
  photo_interior: 'Photo — interior',
};

/** Days before expiry at which a document is flagged "expiring soon". */
export const EXPIRY_WARNING_DAYS = 30;

/* ─── registration number ───────────────────────────────────────────────── */

/** Uppercase, strip spaces/hyphens/dots: "mh 12-ab 1234" → "MH12AB1234". */
export function normaliseRegistration(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-.]/g, '');
}

const STANDARD = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/; // MH12AB1234, DL1CAB1234, KA01F123
const BH_SERIES = /^\d{2}BH\d{4}[A-Z]{1,2}$/; // 22BH1234AB
const STATE_CODES = new Set([
  'AN',
  'AP',
  'AR',
  'AS',
  'BR',
  'CG',
  'CH',
  'DD',
  'DL',
  'DN',
  'GA',
  'GJ',
  'HP',
  'HR',
  'JH',
  'JK',
  'KA',
  'KL',
  'LA',
  'LD',
  'MH',
  'ML',
  'MN',
  'MP',
  'MZ',
  'NL',
  'OD',
  'OR',
  'PB',
  'PY',
  'RJ',
  'SK',
  'TN',
  'TR',
  'TS',
  'UK',
  'UP',
  'WB',
]);

export function validateRegistration(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = normaliseRegistration(raw ?? '');
  if (!value) return { ok: false, error: 'Registration number is required' };
  if (value.length > 12) return { ok: false, error: 'Registration number is too long' };
  if (BH_SERIES.test(value)) return { ok: true, value };
  if (!STANDARD.test(value)) {
    return {
      ok: false,
      error: 'Not a valid Indian registration number (e.g. MH12AB1234 or 22BH1234AB)',
    };
  }
  if (!STATE_CODES.has(value.slice(0, 2))) {
    return { ok: false, error: `'${value.slice(0, 2)}' is not a valid state/UT code` };
  }
  if (/0{4}$/.test(value)) return { ok: false, error: 'Registration number cannot end in 0000' };
  return { ok: true, value };
}

/** Chassis (VIN) numbers are 17 chars in India since 2001; older buses may be shorter. No I/O/Q in a VIN. */
export function validateChassis(raw: string | undefined | null): string | null {
  if (raw == null || raw === '') return null;
  const v = raw.toUpperCase().replace(/\s/g, '');
  if (v.length < 6 || v.length > 17) return 'Chassis number must be 6–17 characters';
  if (!/^[A-HJ-NPR-Z0-9]+$/.test(v))
    return 'Chassis number may only contain letters (except I, O, Q) and digits';
  return null;
}

export function validateManufactureYear(
  year: number | undefined | null,
  now: Date = new Date(),
): string | null {
  if (year == null) return null;
  const max = now.getFullYear() + 1; // model-year buses can be registered in the preceding year
  if (!Number.isInteger(year) || year < 1980 || year > max)
    return `Manufacture year must be between 1980 and ${max}`;
  return null;
}

/* ─── documents & compliance ────────────────────────────────────────────── */

export interface DocVersion {
  id: string;
  docType: string;
  documentNo: string | null;
  validFrom: string | null; // YYYY-MM-DD
  expiresOn: string; // YYYY-MM-DD
  status: DocVerification;
  hasFile: boolean;
  supersededAt?: string | null;
}

export interface Compliance {
  compliant: boolean;
  missing: string[]; // no version at all
  pendingReview: string[]; // has an upload awaiting admin (incl. renewals of a still-valid doc)
  awaitingVerification: string[]; // non-compliant ONLY because the upload is not verified yet
  rejected: string[]; // latest submission rejected and no valid verified version
  expired: string[]; // only expired verified versions remain
  expiringSoon: string[]; // verified + valid, but within EXPIRY_WARNING_DAYS
  readyForSubmission: boolean; // every required type has at least an uploaded (pending/verified, unexpired) version with a file
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000,
  );
}

/** today: YYYY-MM-DD in the platform's timezone. */
export function computeCompliance(docs: DocVersion[], today: string): Compliance {
  const out: Compliance = {
    compliant: true,
    missing: [],
    pendingReview: [],
    awaitingVerification: [],
    rejected: [],
    expired: [],
    expiringSoon: [],
    readyForSubmission: true,
  };
  for (const type of REQUIRED_DOC_TYPES) {
    const versions = docs.filter((d) => d.docType === type && !d.supersededAt);
    const validVerified = versions.filter((d) => d.status === 'verified' && d.expiresOn >= today);
    const pending = versions.filter(
      (d) => d.status === 'pending' && d.expiresOn >= today && d.hasFile,
    );

    if (versions.length === 0) {
      out.missing.push(type);
      out.compliant = false;
      out.readyForSubmission = false;
      continue;
    }
    if (pending.length > 0) out.pendingReview.push(type);

    if (validVerified.length > 0) {
      const latestExpiry = validVerified
        .map((d) => d.expiresOn)
        .sort()
        .at(-1)!;
      if (daysBetween(today, latestExpiry) <= EXPIRY_WARNING_DAYS) out.expiringSoon.push(type);
      continue;
    }

    out.compliant = false;
    if (pending.length > 0) {
      out.awaitingVerification.push(type);
      continue;
    }
    if (versions.some((d) => d.status === 'verified')) out.expired.push(type);
    else if (versions.some((d) => d.status === 'rejected')) out.rejected.push(type);
    else out.missing.push(type); // e.g. only an expired pending upload, or no file
    out.readyForSubmission = false;
  }
  return out;
}

/** Validates one document upload before it is stored. */
export function validateDocument(input: {
  docType: string;
  documentNo?: string | null;
  validFrom?: string | null;
  expiresOn: string;
  today: string;
  registrationNo?: string;
}): string | null {
  if (!ALL_DOC_TYPES.includes(input.docType)) return `Unknown document type '${input.docType}'`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) || Number.isNaN(Date.parse(input.expiresOn)))
    return 'Expiry date must be a valid YYYY-MM-DD date';
  if (
    input.validFrom &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom) || Number.isNaN(Date.parse(input.validFrom)))
  )
    return 'Valid-from must be a valid YYYY-MM-DD date';
  if (input.validFrom && input.validFrom > input.expiresOn)
    return 'Valid-from date cannot be after the expiry date';
  if (input.validFrom && input.validFrom > input.today)
    return 'Valid-from date cannot be in the future';
  if (input.expiresOn < input.today)
    return 'This document has already expired — upload the renewed one';
  const isPhoto = input.docType.startsWith('photo_');
  if (
    !isPhoto &&
    (REQUIRED_DOC_TYPES as readonly string[]).includes(input.docType) &&
    !input.documentNo?.trim()
  ) {
    return 'Document number is required';
  }
  if (
    input.docType === 'rc' &&
    input.registrationNo &&
    input.documentNo &&
    normaliseRegistration(input.documentNo) !== normaliseRegistration(input.registrationNo)
  ) {
    return `RC number (${normaliseRegistration(input.documentNo)}) does not match this bus's registration (${input.registrationNo})`;
  }
  return null;
}

/* ─── status machine ────────────────────────────────────────────────────── */

type Actor = 'operator' | 'admin' | 'system';

const TRANSITIONS: Record<VerificationStatus, Partial<Record<VerificationStatus, Actor[]>>> = {
  draft: { submitted: ['operator'] },
  rejected: { submitted: ['operator'] },
  submitted: { approved: ['admin'], rejected: ['admin'], draft: ['operator'] }, // operator may withdraw to fix
  approved: { suspended: ['admin', 'system'] },
  suspended: { submitted: ['operator'], approved: ['admin'] },
};

export function canTransition(
  from: VerificationStatus,
  to: VerificationStatus,
  actor: Actor,
): boolean {
  return TRANSITIONS[from][to]?.includes(actor) ?? false;
}

/** Why a bus cannot be approved right now (empty = can approve). */
export function approvalBlockers(c: Compliance): string[] {
  const reasons: string[] = [];
  const label = (t: string) => DOC_LABELS[t] ?? t;
  if (c.missing.length) reasons.push(`Missing: ${c.missing.map(label).join(', ')}`);
  if (c.awaitingVerification.length)
    reasons.push(`Not yet verified: ${c.awaitingVerification.map(label).join(', ')}`);
  if (c.rejected.length) reasons.push(`Rejected: ${c.rejected.map(label).join(', ')}`);
  if (c.expired.length) reasons.push(`Expired: ${c.expired.map(label).join(', ')}`);
  if (!c.compliant && reasons.length === 0)
    reasons.push('Required documents are not all verified and valid');
  return reasons;
}

export function minReason(reason: string | undefined | null, min = 10): string | null {
  const r = reason?.trim() ?? '';
  if (r.length < min) return `Please give a clear reason (at least ${min} characters)`;
  if (r.length > 1000) return 'Reason is too long (max 1000 characters)';
  return null;
}
