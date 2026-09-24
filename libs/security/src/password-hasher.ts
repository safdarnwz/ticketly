import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, derived) =>
      err ? reject(err) : resolve(derived),
    );
  });
}

/**
 * ============================================================================
 *  Password hashing
 * ============================================================================
 *
 * WHY scrypt (Node built-in) and not bcrypt/argon2 native addons:
 *  - No native compilation, no `node-gyp`, no Docker — which is a hard project
 *    constraint. scrypt is memory-hard (resists GPU/ASIC cracking) and ships in
 *    Node's core `crypto`, so there is nothing to build.
 *  - The output is self-describing (`scrypt$N$r$p$salt$hash`), so cost
 *    parameters can be raised over time and old hashes still verify — and
 *    `needsRehash()` tells the login flow to transparently upgrade a user's
 *    hash on their next successful sign-in.
 *
 * SECURITY PROPERTIES:
 *  - Per-hash random salt (16 bytes) → identical passwords produce different
 *    hashes, defeating rainbow tables.
 *  - `timingSafeEqual` on verify → no timing side channel.
 *  - Cost parameters come from config so they can be tuned per environment
 *    (tests use a low cost for speed; production uses a high one).
 */
@Injectable()
export class PasswordHasher {
  private readonly cost: number;
  private readonly blockSize: number;
  private readonly parallelism: number;
  private readonly keyLength = 64;

  constructor(config: AppConfig) {
    // Map the argon-style knobs in config onto scrypt's N/r/p. `memoryKiB`
    // drives N (CPU/memory cost) so raising it strengthens hashing uniformly.
    const memoryKiB = config.security.passwordHash.memoryKiB;
    this.cost = clampPow2(Math.max(16384, memoryKiB)); // N, power of two
    this.blockSize = 8; // r
    this.parallelism = config.security.passwordHash.parallelism; // p
  }

  async hash(password: string): Promise<string> {
    assertPasswordShape(password);
    const salt = randomBytes(16);
    const derived = await scryptAsync(password.normalize('NFKC'), salt, this.keyLength, {
      N: this.cost,
      r: this.blockSize,
      p: this.parallelism,
      maxmem: 256 * 1024 * 1024,
    });
    return `scrypt$${this.cost}$${this.blockSize}$${this.parallelism}$${salt.toString('base64')}$${derived.toString('base64')}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parseHash(stored);
    if (!parsed) return false;
    try {
      const derived = await scryptAsync(
        password.normalize('NFKC'),
        parsed.salt,
        parsed.hash.length,
        {
          N: parsed.n,
          r: parsed.r,
          p: parsed.p,
          maxmem: 256 * 1024 * 1024,
        },
      );
      return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
    } catch {
      return false;
    }
  }

  /** True when the stored hash used weaker parameters than we now require. */
  needsRehash(stored: string): boolean {
    const parsed = parseHash(stored);
    if (!parsed) return true;
    return parsed.n < this.cost || parsed.r < this.blockSize || parsed.p < this.parallelism;
  }
}

interface ParsedHash {
  n: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, hash] = parts;
  return {
    n: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  };
}

function assertPasswordShape(password: string): void {
  if (typeof password !== 'string' || password.length < 8 || password.length > 256) {
    throw new Error('Password must be between 8 and 256 characters');
  }
}

function clampPow2(value: number): number {
  let n = 16384;
  while (n < value && n < 1_048_576) n *= 2;
  return n;
}
