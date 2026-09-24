/**
 * Object key layout — pure, provider-independent:
 *
 *   [prefix/]{operator-slug}/{folder}/{...sub}/{file}
 *   e.g.  orange-travels/branding/logo.svg
 *         orange-travels/vehicles/MH12AB1234/insurance/01926c1e-...-insurance.pdf
 *
 * Every segment is sanitised: lowercase-safe charset, no '..', no empty
 * segments, no leading slash — so a hostile file name or slug can never
 * escape the operator's own folder or overwrite another operator's object.
 */
export const FOLDERS = ['branding', 'vehicles', 'kyc', 'crew', 'documents', 'misc'] as const;
export type Folder = (typeof FOLDERS)[number];

export function sanitiseSegment(raw: string, { lower = false }: { lower?: boolean } = {}): string {
  let s = String(raw ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  if (lower) s = s.toLowerCase();
  s = s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/-+\./g, '.').replace(/^[-.]+|[-.]+$/g, '');
  if (s === '' || s === '.' || s === '..') throw new Error(`Invalid storage path segment: '${raw}'`);
  return s.slice(0, 120);
}

export function buildObjectKey(input: { prefix?: string; tenantSlug: string; folder: Folder; sub?: string[]; fileName: string }): string {
  if (!FOLDERS.includes(input.folder)) throw new Error(`Unknown storage folder '${input.folder}'`);
  const parts = [
    ...(input.prefix ? input.prefix.split('/').filter(Boolean).map((p) => sanitiseSegment(p, { lower: true })) : []),
    sanitiseSegment(input.tenantSlug, { lower: true }),
    input.folder,
    ...(input.sub ?? []).map((p) => sanitiseSegment(p)),
    sanitiseSegment(input.fileName),
  ];
  const key = parts.join('/');
  if (Buffer.byteLength(key) > 1024) throw new Error('Storage key too long');
  return key;
}

/** Encode a key for use in a URL path: each segment encoded, '/' kept. */
export function encodeKeyForUrl(key: string): string {
  return key.split('/').map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}
