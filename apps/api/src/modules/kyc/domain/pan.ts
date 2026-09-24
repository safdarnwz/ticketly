/**
 * ============================================================================
 *  PAN structural validation — offline, free, no API
 * ============================================================================
 *
 * PAN format is fixed and public: AAAAA9999A (5 letters, 4 digits, 1 letter).
 * The 4th letter encodes the holder type (P=individual, C=company, H=HUF,
 * F=firm, A=AOP, T=trust, B=BOI, L=local authority, J=artificial judicial
 * person, G=government).
 *
 * IMPORTANT, stated plainly rather than glossed over: the Income Tax
 * Department's actual check-digit algorithm for the final letter is NOT
 * publicly documented (unlike Aadhaar's published Verhoeff checksum). This
 * function can only confirm the PAN is STRUCTURALLY well-formed and has a
 * valid holder-type code — it cannot confirm the PAN actually EXISTS or
 * belongs to the applicant. That confirmation is exactly what the
 * DigiLocker path (digilocker-client.ts) is for: DigiLocker only ever
 * hands back a document that genuinely exists in the applicant's account.
 */

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const VALID_HOLDER_TYPES = new Set(['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G']);

export interface PanFormatResult {
  wellFormed: boolean;
  holderType: string | null;
  reason?: string;
}

export function checkPanFormat(rawPan: string): PanFormatResult {
  const pan = rawPan.trim().toUpperCase();
  if (!PAN_PATTERN.test(pan)) {
    return { wellFormed: false, holderType: null, reason: 'PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)' };
  }
  const holderType = pan[3];
  if (!VALID_HOLDER_TYPES.has(holderType)) {
    return { wellFormed: false, holderType: null, reason: `Unrecognised holder-type code '${holderType}' in 4th position` };
  }
  return { wellFormed: true, holderType };
}
