import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * GDS partner API keys — pure helpers.
 * Format: gds_<live|test>_<8-char prefix>_<32-char secret>. Only the sha256 of
 * the full key is stored; the prefix (unique, indexed) finds the row, then a
 * constant-time hash comparison verifies it. The key is shown ONCE at creation.
 */
export function generateKey(sandbox: boolean): { key: string; prefix: string; hash: string } {
  const prefix = randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8);
  const secret = randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 32);
  const key = `gds_${sandbox ? 'test' : 'live'}_${prefix}_${secret}`;
  return { key, prefix, hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function parseKey(raw: string | undefined): { prefix: string; sandbox: boolean } | null {
  const m = /^gds_(live|test)_([A-Za-z0-9]{8})_([A-Za-z0-9]{32})$/.exec(raw?.trim() ?? '');
  return m ? { prefix: m[2], sandbox: m[1] === 'test' } : null;
}

export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** IPv4 / IPv6-mapped-IPv4 CIDR check. Empty allow-list = any IP. */
export function ipAllowed(ip: string | undefined, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  const v4 = (ip ?? '').replace(/^::ffff:/, '');
  const toInt = (a: string) => a.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return false;
  return allowlist.some((cidr) => {
    const [base, bitsRaw] = cidr.split('/');
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(base) || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (toInt(v4) & mask) === (toInt(base) & mask);
  });
}
