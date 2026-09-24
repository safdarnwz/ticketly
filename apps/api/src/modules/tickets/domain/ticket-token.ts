import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Signed ticket token (the QR payload)
 * ============================================================================
 *
 * A ticket's QR code encodes a compact, tamper-evident token: `<payload>.<sig>`,
 * where `payload` is base64url(JSON) and `sig` is an HMAC over the payload
 * computed with the operator's server key. At the gate the conductor app scans
 * it and verifies the signature offline — so a forged or edited ticket (changed
 * seat, changed trip) fails verification without any network call.
 *
 * This module is PURE: it builds/encodes/decodes the payload and checks expiry,
 * and verifies a token given an ALREADY-COMPUTED expected signature (constant
 * time). The HMAC itself is computed in the service via the security lib — the
 * crypto key never touches the domain. That split keeps the encoding rules
 * exhaustively unit-testable while the secret stays in infrastructure.
 */

export interface TicketTokenPayload {
  v: number;          // schema version
  bookingId: string;
  pnr: string;
  tripId: string;
  seat: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

/** The canonical string an HMAC is computed over (the encoded payload). */
export function signingInput(payload: TicketTokenPayload): string {
  // Stable key order → the same payload always yields the same signing input.
  const ordered = {
    v: payload.v, bookingId: payload.bookingId, pnr: payload.pnr, tripId: payload.tripId,
    seat: payload.seat, issuedAtMs: payload.issuedAtMs, expiresAtMs: payload.expiresAtMs,
  };
  return b64urlEncode(JSON.stringify(ordered));
}

/** Assemble the final token from the signing input and its signature. */
export function encodeToken(payloadPart: string, signaturePart: string): string {
  return `${payloadPart}.${signaturePart}`;
}

export function decodeToken(token: string): { payloadPart: string; signaturePart: string; payload: TicketTokenPayload } {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Malformed ticket token');
  }
  let payload: TicketTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(parts[0])) as TicketTokenPayload;
  } catch {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Ticket token payload is not valid');
  }
  if (!payload || payload.v !== 1 || !payload.bookingId || !payload.seat) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Ticket token payload is incomplete');
  }
  return { payloadPart: parts[0], signaturePart: parts[1], payload };
}

export function isExpired(payload: TicketTokenPayload, nowMs: number): boolean {
  return payload.expiresAtMs > 0 && nowMs > payload.expiresAtMs;
}

/** Constant-time string compare — no early exit that could leak the signature. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a token against an already-computed expected signature and check
 * expiry. Returns the payload if valid; throws otherwise. The caller computes
 * `expectedSignature = HMAC(decoded.payloadPart, key)`.
 */
export function verifyToken(token: string, expectedSignature: string, nowMs: number): TicketTokenPayload {
  const decoded = decodeToken(token);
  if (!constantTimeEqual(decoded.signaturePart, expectedSignature)) {
    throw new DomainError(ErrorCode.COMMON_FORBIDDEN, 'Ticket signature does not verify');
  }
  if (isExpired(decoded.payload, nowMs)) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Ticket has expired');
  }
  return decoded.payload;
}

/**
 * ============================================================================
 *  Booking-level QR token — ONE code per PNR, not per seat
 * ============================================================================
 *
 * The ticket shows exactly one QR code for the whole booking. Scanning it at
 * the gate looks up EVERY seat on that PNR: if there's only one passenger,
 * the conductor app checks them in immediately; if there are several, it
 * shows the full manifest (name + seat, per passenger) so the conductor can
 * tick each one off individually as they actually board — a group doesn't
 * have to board together, and a lost/shared phone screenshot only checks in
 * whichever names are tapped, not the whole party at once.
 *
 * Deliberately a SEPARATE payload shape from TicketTokenPayload (no `seat`
 * field — this token represents the booking, not one ticket within it), but
 * reuses the exact same b64url + HMAC + expiry machinery.
 */
export interface BookingQrPayload {
  v: number;
  bookingId: string;
  pnr: string;
  tripId: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export function bookingQrSigningInput(payload: BookingQrPayload): string {
  const ordered = { v: payload.v, bookingId: payload.bookingId, pnr: payload.pnr, tripId: payload.tripId, issuedAtMs: payload.issuedAtMs, expiresAtMs: payload.expiresAtMs };
  return b64urlEncode(JSON.stringify(ordered));
}

export function decodeBookingQrToken(token: string): { payloadPart: string; signaturePart: string; payload: BookingQrPayload } {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Malformed booking QR token');
  }
  let payload: BookingQrPayload;
  try {
    payload = JSON.parse(b64urlDecode(parts[0])) as BookingQrPayload;
  } catch {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Booking QR payload is not valid');
  }
  if (!payload || payload.v !== 1 || !payload.bookingId || !payload.tripId) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Booking QR payload is incomplete');
  }
  return { payloadPart: parts[0], signaturePart: parts[1], payload };
}

export function verifyBookingQrToken(token: string, expectedSignature: string, nowMs: number): BookingQrPayload {
  const decoded = decodeBookingQrToken(token);
  if (!constantTimeEqual(decoded.signaturePart, expectedSignature)) {
    throw new DomainError(ErrorCode.COMMON_FORBIDDEN, 'Booking QR signature does not verify');
  }
  if (decoded.payload.expiresAtMs > 0 && nowMs > decoded.payload.expiresAtMs) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Booking QR has expired');
  }
  return decoded.payload;
}
