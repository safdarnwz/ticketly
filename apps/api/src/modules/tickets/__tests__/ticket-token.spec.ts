import { describe, it, expect } from 'vitest';

import {
  signingInput, encodeToken, decodeToken, isExpired, constantTimeEqual, verifyToken,
  type TicketTokenPayload,
} from '../domain/ticket-token';

const payload = (o: Partial<TicketTokenPayload> = {}): TicketTokenPayload => ({
  v: 1, bookingId: 'b1', pnr: 'YB12AB', tripId: 't1', seat: 'A1',
  issuedAtMs: 1_000_000, expiresAtMs: 2_000_000, ...o,
});

describe('ticket token encode/decode', () => {
  it('happy: round-trips a payload through sign-input → encode → decode', () => {
    const part = signingInput(payload());
    const token = encodeToken(part, 'SIG');
    const decoded = decodeToken(token);
    expect(decoded.payload.seat).toBe('A1');
    expect(decoded.payload.pnr).toBe('YB12AB');
    expect(decoded.signaturePart).toBe('SIG');
  });

  it('positive: signing input is stable regardless of key order in the source object', () => {
    const a = signingInput({ v: 1, seat: 'A1', bookingId: 'b1', pnr: 'YB12AB', tripId: 't1', issuedAtMs: 1_000_000, expiresAtMs: 2_000_000 });
    const b = signingInput(payload());
    expect(a).toBe(b);
  });

  it('negative: a malformed token is rejected', () => {
    expect(() => decodeToken('no-dot')).toThrow();
    expect(() => decodeToken('a.b.c')).toThrow();
    expect(() => decodeToken('.sig')).toThrow();
  });

  it('negative: a tampered payload that is not valid JSON is rejected', () => {
    expect(() => decodeToken('!!!.sig')).toThrow();
  });
});

describe('expiry + constant-time compare', () => {
  it('happy: not expired before the deadline, expired after', () => {
    expect(isExpired(payload(), 1_500_000)).toBe(false);
    expect(isExpired(payload(), 2_000_001)).toBe(true);
  });

  it('edge: expiresAtMs of 0 means no expiry', () => {
    expect(isExpired(payload({ expiresAtMs: 0 }), 9_999_999)).toBe(false);
  });

  it('positive/negative: constant-time equality', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('verifyToken', () => {
  const part = signingInput(payload());
  const token = encodeToken(part, 'GOODSIG');

  it('happy: verifies with the correct signature before expiry', () => {
    expect(verifyToken(token, 'GOODSIG', 1_500_000).seat).toBe('A1');
  });

  it('negative: wrong signature is rejected', () => {
    expect(() => verifyToken(token, 'BADSIG', 1_500_000)).toThrow();
  });

  it('negative: correct signature but expired is rejected', () => {
    expect(() => verifyToken(token, 'GOODSIG', 3_000_000)).toThrow();
  });
});
