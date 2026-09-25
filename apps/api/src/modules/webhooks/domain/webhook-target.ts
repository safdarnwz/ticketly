import { BlockList, isIP } from 'node:net';

/**
 * Where a webhook may point. The platform POSTs to the URL an operator gives
 * (and "send test" reports the status and latency back), so a URL on the
 * platform's own network — localhost, a cloud metadata address, a private
 * range — would let anyone with an operator login probe or hit internal
 * services. Only public https hosts are allowed, checked when the URL is saved
 * AND on every send (a public name can later resolve somewhere private).
 */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i;

/** True for an address that is not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const ip = mapped ? mapped[1] : address;
  const version = isIP(ip);
  if (version === 0) return true; // not an address at all — never trust it
  // Any other IPv4-mapped spelling (e.g. ::ffff:7f00:1) is refused outright.
  if (version === 6 && /^::ffff:/i.test(ip)) return true;
  return PRIVATE.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

/** Why this URL cannot be a webhook target, or null when it can. */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Enter a full URL, like https://partner.example.com/hooks';
  }
  if (url.protocol !== 'https:') return 'Webhook URLs must use https';
  if (url.username || url.password) return 'Put credentials in your endpoint, not in the URL';
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host) !== 0) {
    return isPrivateAddress(host) ? 'That address is not reachable from the internet' : null;
  }
  if (!host.includes('.') || BLOCKED_NAMES.test(host)) {
    return 'Use a public host name, reachable from the internet';
  }
  return null;
}
