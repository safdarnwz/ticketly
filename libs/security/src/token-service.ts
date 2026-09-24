import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnauthenticatedError, ErrorCode, type TenantId, type UserId } from '@kernel';

/**
 * ============================================================================
 *  JWT issue / verify (HS256, zero-dependency)
 * ============================================================================
 *
 * A signed JWT is implemented directly on Node's `crypto` — no `jsonwebtoken`
 * dependency — because the format is small, the security-sensitive parts
 * (constant-time signature compare, strict header/alg checks, expiry) are ones
 * we want to see and control, and it removes a supply-chain surface.
 *
 * TOKEN STRATEGY:
 *  - **Access token**: short-lived (15 min), stateless, carries tenant + user +
 *    a session id + permissions hash. Verified on every request with no
 *    database hit — that is what keeps auth off the hot path.
 *  - **Refresh token**: long-lived, but its jti is stored server-side
 *    (Part 2 sessions table) so it can be revoked. Access tokens are only as
 *    dangerous as their 15-minute lifetime; refresh tokens are revocable.
 *
 * KEY ROTATION: `JWT_SECRET_PREVIOUS` lets us verify tokens signed with the
 * old secret while signing new ones with the current secret — zero-downtime
 * secret rotation.
 */
export type TokenType = 'access' | 'refresh';

export interface AccessTokenClaims {
  sub: UserId;
  tid: TenantId | null;
  sid: string; // session id
  typ: 'access';
  /** Short hash of the permission set — lets us detect stale grants cheaply. */
  ph?: string;
  roles?: string[];
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface RefreshTokenClaims {
  sub: UserId;
  tid: TenantId | null;
  sid: string;
  typ: 'refresh';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfig) {}

  signAccess(claims: Omit<AccessTokenClaims, 'iss' | 'aud' | 'iat' | 'exp' | 'typ'>): {
    token: string;
    expiresAt: Date;
  } {
    return this.sign({ ...claims, typ: 'access' }, this.config.security.accessTtlSeconds);
  }

  signRefresh(claims: Omit<RefreshTokenClaims, 'iss' | 'aud' | 'iat' | 'exp' | 'typ'>): {
    token: string;
    expiresAt: Date;
  } {
    return this.sign({ ...claims, typ: 'refresh' }, this.config.security.refreshTtlSeconds);
  }

  verifyAccess(token: string): AccessTokenClaims {
    const claims = this.verify(token);
    if (claims.typ !== 'access') {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Expected an access token',
      });
    }
    return claims;
  }

  verifyRefresh(token: string): RefreshTokenClaims {
    const claims = this.verify(token);
    if (claims.typ !== 'refresh') {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Expected a refresh token',
      });
    }
    return claims;
  }

  /* ── internals ────────────────────────────────────────────────────────*/

  private sign(
    payload: Record<string, unknown>,
    ttlSeconds: number,
  ): { token: string; expiresAt: Date } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;
    const fullPayload = {
      ...payload,
      iss: this.config.security.issuer,
      aud: this.config.security.audience,
      iat: now,
      exp,
    };
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify(fullPayload));
    const signature = this.hmac(`${header}.${body}`, this.config.security.jwtSecret);
    return { token: `${header}.${body}.${signature}`, expiresAt: new Date(exp * 1000) };
  }

  private verify(token: string): AccessTokenClaims | RefreshTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, { message: 'Malformed token' });
    }
    const [header, body, signature] = parts;

    // Reject anything that is not exactly HS256 — prevents the classic
    // "alg: none" and algorithm-confusion attacks.
    const decodedHeader = safeJsonParse(header);
    if (!decodedHeader || decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Unsupported token algorithm',
      });
    }

    // Accept the current secret OR the previous one (rotation window).
    const signingInput = `${header}.${body}`;
    const validSignature =
      this.signatureMatches(signingInput, signature, this.config.security.jwtSecret) ||
      (this.config.security.jwtSecretPrevious
        ? this.signatureMatches(signingInput, signature, this.config.security.jwtSecretPrevious)
        : false);

    if (!validSignature) {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Invalid token signature',
      });
    }

    const claims = safeJsonParse(body) as unknown as
      (AccessTokenClaims | RefreshTokenClaims) | null;
    if (!claims) {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Malformed token payload',
      });
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < now) {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_EXPIRED, {
        message: 'Token has expired',
      });
    }
    if (
      claims.iss !== this.config.security.issuer ||
      claims.aud !== this.config.security.audience
    ) {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, {
        message: 'Token issuer/audience mismatch',
      });
    }
    return claims;
  }

  private hmac(input: string, secret: string): string {
    return createHmac('sha256', secret).update(input).digest('base64url');
  }

  private signatureMatches(input: string, signature: string, secret: string): boolean {
    const expected = this.hmac(input, secret);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function safeJsonParse(b64: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
