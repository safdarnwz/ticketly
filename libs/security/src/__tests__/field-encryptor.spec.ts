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
