import { describe, expect, it } from 'vitest';

import { generateKey, hashKey, hashesEqual, ipAllowed, parseKey } from '../domain/gds-keys';

describe('GDS API keys', () => {
  it('generated keys parse back, and only the hash is needed to verify', () => {
    const k = generateKey(false);
    const p = parseKey(k.key)!;
    expect(p.prefix).toBe(k.prefix);
    expect(p.sandbox).toBe(false);
    expect(hashesEqual(hashKey(k.key), k.hash)).toBe(true);
    expect(parseKey(generateKey(true).key)!.sandbox).toBe(true);
  });
  it('rejects malformed / tampered keys', () => {
    expect(parseKey(undefined)).toBeNull();
    expect(parseKey('gds_live_short_x')).toBeNull();
    const k = generateKey(false);
    expect(hashesEqual(hashKey(k.key + 'x'), k.hash)).toBe(false);
    expect(hashesEqual('ab', k.hash)).toBe(false);
  });
});

describe('ipAllowed', () => {
  it('empty allow-list allows all; CIDR ranges and exact IPs', () => {
    expect(ipAllowed('1.2.3.4', [])).toBe(true);
    expect(ipAllowed('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipAllowed('11.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('::ffff:203.0.113.5', ['203.0.113.5/32'])).toBe(true);
    expect(ipAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
    expect(ipAllowed(undefined, ['10.0.0.0/8'])).toBe(false);
    expect(ipAllowed('garbage', ['10.0.0.0/8'])).toBe(false);
  });
});
