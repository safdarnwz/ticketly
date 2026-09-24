import { BlockList, isIP } from 'node:net';

/**
 * IP allowlist for platform-admin access (#26).
 *
 * Entries are single addresses or CIDR ranges, IPv4 or IPv6. An EMPTY list
 * means "no restriction" — so turning the feature on is always an explicit act
 * and a fresh install can never lock its only admin out.
 */
export interface ParsedEntry {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

export function parseAllowlistEntry(raw: string): ParsedEntry | null {
  const value = raw.trim();
  const [address, prefixRaw] = value.split('/');
  const version = isIP(address ?? '');
  if (version === 0) return null;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  const max = version === 4 ? 32 : 128;
  if (prefixRaw === undefined) return { address: address, prefix: max, family };
  if (!/^\d{1,3}$/.test(prefixRaw)) return null;
  const prefix = Number(prefixRaw);
  if (prefix < 0 || prefix > max) return null;
  return { address: address, prefix, family };
}

/** Invalid entries, for a 422 before anything is saved. */
export function invalidAllowlistEntries(entries: string[]): string[] {
  return entries.filter((e) => parseAllowlistEntry(e) === null);
}

/** `::ffff:10.0.0.1` (how Node reports IPv4 on a dual-stack socket) → `10.0.0.1`. */
export function normaliseIp(ip: string): string {
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

export function isIpAllowed(entries: string[], ip: string | null | undefined): boolean {
  if (entries.length === 0) return true;
  if (!ip) return false;
  const candidate = normaliseIp(ip);
  const version = isIP(candidate);
  if (version === 0) return false;
  const list = new BlockList();
  for (const raw of entries) {
    const e = parseAllowlistEntry(raw);
    if (!e) continue;
    list.addSubnet(e.address, e.prefix, e.family);
  }
  return list.check(candidate, version === 4 ? 'ipv4' : 'ipv6');
}
