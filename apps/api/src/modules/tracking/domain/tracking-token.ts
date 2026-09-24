import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Live-tracking link token
 * ============================================================================
 *
 * A signed token that lets a passenger open a PUBLIC live-tracking page for
 * their OWN trip, without logging in — the same domain-separated
 * b64url+HMAC pattern as ticket-token.ts's BookingQrPayload, but for a
 * DIFFERENT purpose (viewing the bus's live position, not boarding
 * verification) and with its OWN signing-key derivation, so a leaked
 * tracking link can never be replayed as a boarding QR or vice-versa.
 *
 * Deliberately long-lived relative to a single boarding window — a
 * passenger may reasonably want to check the map hours before departure
 * through arrival, not just in a tight pre-boarding cutoff.
 */
export interface TrackingTokenPayload {
  v: number;
  bookingId: string;
  tripId: string;
  pnr: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function trackingSigningInput(payload: TrackingTokenPayload): string {
  const ordered = {
    v: payload.v,
    bookingId: payload.bookingId,
    tripId: payload.tripId,
    pnr: payload.pnr,
    issuedAtMs: payload.issuedAtMs,
    expiresAtMs: payload.expiresAtMs,
  };
  return b64urlEncode(JSON.stringify(ordered));
}

export function encodeTrackingToken(payloadPart: string, signaturePart: string): string {
  return `${payloadPart}.${signaturePart}`;
}

export function decodeTrackingToken(token: string): {
  payloadPart: string;
  signaturePart: string;
  payload: TrackingTokenPayload;
} {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Malformed tracking link');
  }
  let payload: TrackingTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(parts[0])) as TrackingTokenPayload;
  } catch {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Tracking link payload is not valid');
  }
  if (!payload || payload.v !== 1 || !payload.bookingId || !payload.tripId) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Tracking link payload is incomplete');
  }
  return { payloadPart: parts[0], signaturePart: parts[1], payload };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function verifyTrackingToken(
  token: string,
  expectedSignature: string,
  nowMs: number,
): TrackingTokenPayload {
  const decoded = decodeTrackingToken(token);
  if (!constantTimeEqual(decoded.signaturePart, expectedSignature)) {
    throw new DomainError(ErrorCode.COMMON_FORBIDDEN, 'Tracking link signature does not verify');
  }
  if (decoded.payload.expiresAtMs > 0 && nowMs > decoded.payload.expiresAtMs) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Tracking link has expired');
  }
  return decoded.payload;
}

/**
 * Signature-only verification, deliberately WITHOUT the expiry check —
 * used as a fallback when the fixed expiresAtMs (scheduled-arrival + 12h)
 * has passed but the trip's own LIVE status says it's still genuinely in
 * progress. A trip running 12+ hours behind schedule is a real thing on
 * long-haul routes (traffic, breakdowns, weather) — the token's whole
 * purpose is to let a passenger check "where is my bus" during exactly
 * this kind of delay, so having it expire BECAUSE of the delay, right
 * when it's most needed, defeats the point. Security is unweakened: the
 * signature check is identical, and the caller (TrackingService) only
 * uses this fallback after separately confirming the trip hasn't
 * actually completed.
 */
export function verifyTrackingTokenSignatureOnly(
  token: string,
  expectedSignature: string,
): TrackingTokenPayload {
  const decoded = decodeTrackingToken(token);
  if (!constantTimeEqual(decoded.signaturePart, expectedSignature)) {
    throw new DomainError(ErrorCode.COMMON_FORBIDDEN, 'Tracking link signature does not verify');
  }
  return decoded.payload;
}
