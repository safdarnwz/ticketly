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
 *  - **Key id prefix** (`v1:`, `v2:` …) so keys can be rotated (#120): new
 *    writes use the current key (ENCRYPTION_KEY / ENCRYPTION_KEY_ID), older
 *    values still decrypt under a retired key (ENCRYPTION_PREVIOUS_KEYS) until
 *    the re-encryption job has rewritten them with the current one.
 *  - **Blind-index companion** (`blindIndex`) — a keyed HMAC of the normalised
 *    value that IS deterministic, so we can still do exact-match lookups
 *    ("find the booking for this phone number") without decrypting every row.
 *    The encrypted column is unsearchable by design; the blind index is how you
 *    search it safely.
 *
 * Storage format: `<keyId>:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
 *
 * The blind-index key is separate and never rotates with the encryption key
 * (BLIND_INDEX_KEY, or derived from the original v1 key) — a new key must not
 * make every stored phone / email unfindable.
 */
@Injectable()
export class FieldEncryptor {
  private readonly keyId: string | null;
  private readonly keys = new Map<string, Buffer>();
  private readonly blindKey: Buffer | null;

  constructor(config: AppConfig) {
    const { encryptionKey, encryptionKeyId, encryptionPreviousKeys, blindIndexKey } =
      config.security;
    if (encryptionKey && encryptionKey.length > 0) {
      this.keyId = encryptionKeyId || 'v1';
      this.keys.set(this.keyId, parseKey(encryptionKey, 'ENCRYPTION_KEY'));
      for (const entry of (encryptionPreviousKeys ?? '').split(',').map((e) => e.trim())) {
        if (!entry) continue;
        const [id, b64] = entry.split(/:(.*)/s);
        if (!id || !/^v\d{1,4}$/.test(id) || !b64)
          throw new Error('ENCRYPTION_PREVIOUS_KEYS entries look like v1:<base64 key>');
        if (id === this.keyId)
          throw new Error(`ENCRYPTION_PREVIOUS_KEYS repeats the current key id ${id}`);
        this.keys.set(id, parseKey(b64, `ENCRYPTION_PREVIOUS_KEYS ${id}`));
      }
      const v1 = this.keys.get('v1');
      if (!blindIndexKey && !v1 && this.keyId !== 'v1')
        // The blind indexes were made with a key derived from the original
        // key; without it every phone / email lookup (and login) would miss.
        throw new Error(
          'Set BLIND_INDEX_KEY to the original (v1) ENCRYPTION_KEY before removing that key from ENCRYPTION_PREVIOUS_KEYS',
        );
      const blindSource = blindIndexKey
        ? parseKey(blindIndexKey, 'BLIND_INDEX_KEY')
        : (v1 ?? this.keys.get(this.keyId)!);
      // Derived, so the blind index and the ciphertext never share key material.
      this.blindKey = createHash('sha256').update(blindSource).update('blind-index').digest();
    } else {
      // Encryption is optional in development. Refuse to boot without it in prod.
      if (config.isProduction) {
        throw new Error('ENCRYPTION_KEY is required in production for PII protection');
      }
      this.keyId = null;
      this.blindKey = null;
    }
  }

  get enabled(): boolean {
    return this.keyId !== null;
  }

  /** Id of the key new values are encrypted with (null when encryption is off). */
  get currentKeyId(): string | null {
    return this.keyId;
  }

  /** Encrypt a plaintext value. Returns it unchanged if encryption is disabled. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined) return null;
    if (!this.keyId) return plaintext; // dev fallback
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.keyId)!, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${this.keyId}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  /** Decrypt a stored value. Passes through plaintext written before encryption. */
  decrypt(stored: string | null | undefined): string | null {
    if (stored === null || stored === undefined) return null;
    const keyId = this.keyIdOf(stored);
    if (!this.keyId || keyId === null) return stored;
    const key = this.keys.get(keyId);
    if (!key)
      throw new Error(
        `Value encrypted with key ${keyId}, which is not configured (add it to ENCRYPTION_PREVIOUS_KEYS)`,
      );
    const [, ivB64, tagB64, dataB64] = stored.split(':');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * Whether a stored value should be rewritten with the current key: it was
   * encrypted with a retired key, or written as plaintext before encryption
   * was switched on.
   */
  needsReencryption(stored: string | null | undefined): boolean {
    if (!this.keyId || stored === null || stored === undefined || stored === '') return false;
    return this.keyIdOf(stored) !== this.keyId;
  }

  /** `v2` for `v2:iv:tag:data`; null for a plaintext value. */
  keyIdOf(stored: string): string | null {
    const m = /^(v\d{1,4}):[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/.exec(stored);
    return m ? m[1] : null;
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
    return createHash('sha256').update(this.blindKey).update(normalised).digest('hex');
  }
}

function parseKey(b64: string, name: string): Buffer {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32)
    throw new Error(
      `${name} must be a base64-encoded 32-byte (256-bit) key — make one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  return key;
}
