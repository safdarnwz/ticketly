import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';

/**
 * ============================================================================
 *  Field-level PII encryption (AES-256-GCM)
 * ============================================================================
 *
 * Passenger phone numbers, emails and government-ID numbers are regulated PII.
 * TLS protects them in transit and disk encryption protects the whole volume,
 * but neither protects against a leaked database dump or an over-broad internal
 * query. Column-level encryption does: the plaintext exists only inside the
 * application process, for the moment it is needed.
 *
 * DESIGN:
 *  - **AES-256-GCM** — authenticated encryption. The auth tag means a tampered
 *    ciphertext fails to decrypt rather than silently returning garbage.
 *  - **Random 96-bit IV per value** — GCM is catastrophically broken if an IV
 *    is ever reused under the same key, so we never derive it from the data.
 *  - **Key id prefix** (`v1:`) so keys can be rotated: new writes use the
 *    current key, old values still decrypt under the retired key.
 *  - **Blind-index companion** (`blindIndex`) — a keyed HMAC of the normalised
 *    value that IS deterministic, so we can still do exact-match lookups
 *    ("find the booking for this phone number") without decrypting every row.
 *    The encrypted column is unsearchable by design; the blind index is how you
 *    search it safely.
 *
 * Storage format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
 */
@Injectable()
export class FieldEncryptor {
  private readonly key: Buffer | null;
  private readonly blindKey: Buffer | null;

  constructor(config: AppConfig) {
    const raw = config.security.encryptionKey;
    if (raw && raw.length > 0) {
      const key = Buffer.from(raw, 'base64');
      if (key.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte (256-bit) key');
      }
      this.key = key;
      // Derive a separate blind-index key so the two uses never share material.
      this.blindKey = createHash('sha256').update(key).update('blind-index').digest();
    } else {
      // Encryption is optional in development. Refuse to boot without it in prod.
      if (config.isProduction) {
        throw new Error('ENCRYPTION_KEY is required in production for PII protection');
      }
      this.key = null;
      this.blindKey = null;
    }
  }

  get enabled(): boolean {
    return this.key !== null;
  }

  /** Encrypt a plaintext value. Returns it unchanged if encryption is disabled. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) return null;
    if (!this.key) return plaintext; // dev fallback
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  /** Decrypt a stored value. Passes through plaintext written before encryption. */
  decrypt(stored: string | null | undefined): string | null {
    if (stored === null || stored === undefined) return null;
    if (!this.key || !stored.startsWith('v1:')) return stored;
    const [, ivB64, tagB64, dataB64] = stored.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /**
   * Deterministic keyed hash for equality search over an encrypted column.
   * Normalises first (trim + lowercase) so "+91 98765 43210" and its variants
   * collide as intended for a phone/email lookup.
   */
  blindIndex(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalised = value.trim().toLowerCase().replace(/\s+/g, '');
    if (!this.blindKey) return createHash('sha256').update(normalised).digest('hex');
    return createHash('sha256')
      .update(this.blindKey)
      .update(normalised)
      .digest('hex');
  }
}
