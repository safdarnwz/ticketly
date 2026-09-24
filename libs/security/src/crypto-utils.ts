import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison.
 *
 * A normal `===` on a secret (API key, token, OTP) leaks length and, via early
 * exit, information about how many leading characters matched — enough for a
 * timing attack over many requests. `timingSafeEqual` compares in time
 * independent of where the first difference is. Lengths are equalised via a
 * hash so we never leak the secret's length either.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** URL-safe random token — for API keys, opaque handles, CSRF tokens. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Stable, non-reversible fingerprint of a secret, safe to store/index. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * HMAC-SHA256 of `data` under `key`, base64url-encoded. Used to sign compact,
 * offline-verifiable tokens (e.g. the ticket QR payload) — deterministic, so the
 * same (key, data) always yields the same signature for verification.
 */
export function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}
