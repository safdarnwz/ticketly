import { describe, expect, it } from 'vitest';

import { testConfig } from '@config';

import { FieldEncryptor } from '../field-encryptor';

describe('FieldEncryptor', () => {
  const encryptor = new FieldEncryptor(
    testConfig({ ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }),
  );

  it('round-trips a value and authenticates it', () => {
    const ciphertext = encryptor.encrypt('+91 98765 43210');
    expect(ciphertext?.startsWith('v1:')).toBe(true);
    expect(encryptor.decrypt(ciphertext)).toBe('+91 98765 43210');
  });

  it('produces a fresh IV each time (ciphertexts differ, both decrypt)', () => {
    const a = encryptor.encrypt('secret');
    const b = encryptor.encrypt('secret');
    expect(a).not.toBe(b);
    expect(encryptor.decrypt(a)).toBe('secret');
    expect(encryptor.decrypt(b)).toBe('secret');
  });

  it('blind index is deterministic and normalising (enables lookup)', () => {
    expect(encryptor.blindIndex('+91 98765 43210')).toBe(encryptor.blindIndex('+919876543210'));
    expect(encryptor.blindIndex('a@x.com')).not.toBe(encryptor.blindIndex('b@x.com'));
  });
});

describe('FieldEncryptor key rotation (#120)', () => {
  const k1 = Buffer.alloc(32, 7).toString('base64');
  const k2 = Buffer.alloc(32, 9).toString('base64');
  const before = new FieldEncryptor(testConfig({ ENCRYPTION_KEY: k1 }));
  const after = new FieldEncryptor(
    testConfig({
      ENCRYPTION_KEY: k2,
      ENCRYPTION_KEY_ID: 'v2',
      ENCRYPTION_PREVIOUS_KEYS: `v1:${k1}`,
    }),
  );

  it('new writes use the new key; old values still decrypt', () => {
    const old = before.encrypt('a@x.com');
    const fresh = after.encrypt('a@x.com');
    expect(fresh?.startsWith('v2:')).toBe(true);
    expect(after.decrypt(old)).toBe('a@x.com');
    expect(after.decrypt(fresh)).toBe('a@x.com');
  });

  it('knows which values need re-encryption', () => {
    expect(after.needsReencryption(before.encrypt('x'))).toBe(true);
    expect(after.needsReencryption(after.encrypt('x'))).toBe(false);
    expect(after.needsReencryption('plain@x.com')).toBe(true);
    expect(after.needsReencryption(null)).toBe(false);
  });

  it('keeps the blind index stable across the rotation', () => {
    expect(after.blindIndex('+91 98765 43210')).toBe(before.blindIndex('+919876543210'));
  });

  it('a value under an unknown key fails loudly', () => {
    const lost = new FieldEncryptor(
      testConfig({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: 'v2', BLIND_INDEX_KEY: k1 }),
    );
    expect(() => lost.decrypt(before.encrypt('x'))).toThrow(/ENCRYPTION_PREVIOUS_KEYS/);
  });

  it('refuses to boot once the v1 key is gone unless BLIND_INDEX_KEY keeps lookups working', () => {
    expect(
      () => new FieldEncryptor(testConfig({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: 'v2' })),
    ).toThrow(/BLIND_INDEX_KEY/);
    const dropped = new FieldEncryptor(
      testConfig({ ENCRYPTION_KEY: k2, ENCRYPTION_KEY_ID: 'v2', BLIND_INDEX_KEY: k1 }),
    );
    expect(dropped.blindIndex('a@x.com')).toBe(before.blindIndex('a@x.com'));
  });
});
