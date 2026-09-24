import { describe, expect, it } from 'vitest';

import { testConfig } from '@config';

import { PasswordHasher } from '../password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher(testConfig());

  it('round-trips a password and rejects the wrong one', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await hasher.verify('correct horse battery staple', hash)).toBe(true);
    expect(await hasher.verify('wrong password', hash)).toBe(false);
  });

  it('salts — identical passwords produce different hashes', async () => {
    expect(await hasher.hash('samePass123')).not.toBe(await hasher.hash('samePass123'));
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await hasher.verify('x', 'not-a-valid-hash')).toBe(false);
  });
});
