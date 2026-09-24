import { createHash, createHmac } from 'node:crypto';

import { encodeKeyForUrl } from './object-key';

/**
 * AWS Signature Version 4 — the auth scheme of AWS S3 AND Cloudflare R2
 * (and MinIO, Backblaze B2 S3 API...). Pure functions, verified against
 * AWS's published test vectors in the unit tests.
 */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const UNSIGNED = 'UNSIGNED-PAYLOAD';

export interface SigV4Creds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

export const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

export function amzDate(d: Date): { amz: string; short: string } {
  const amz = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amz, short: amz.slice(0, 8) };
}

function signingKey(secret: string, short: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, short), region), service), 'aws4_request');
}

const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function canonicalQuery(q: Record<string, string>): string {
  return Object.keys(q)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(q[k])}`)
    .join('&');
}

/** Sign a request with the Authorization header. Returns the headers to send. */
export function signHeaders(input: {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  payloadHash: string;
  creds: SigV4Creds;
  now?: Date;
}): Record<string, string> {
  const service = input.creds.service ?? 's3';
  const { amz, short } = amzDate(input.now ?? new Date());
  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.host,
    'x-amz-date': amz,
    'x-amz-content-sha256': input.payloadHash,
  };
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [
      k.toLowerCase(),
      String(v).trim().replace(/\s+/g, ' '),
    ]),
  );
  const signed = Object.keys(lower).sort();
  const canonical = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery(input.query ?? {}),
    signed.map((k) => `${k}:${lower[k]}\n`).join(''),
    signed.join(';'),
    input.payloadHash,
  ].join('\n');
  const scope = `${short}/${input.creds.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonical)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.creds.secretAccessKey, short, input.creds.region, service),
  )
    .update(toSign)
    .digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.creds.accessKeyId}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
  };
}

/** Presigned GET URL (query-string auth). */
export function presignUrl(input: {
  method?: string;
  protocolHost: string;
  host: string;
  path: string;
  expiresInSeconds: number;
  extraQuery?: Record<string, string>;
  creds: SigV4Creds;
  now?: Date;
}): string {
  const service = input.creds.service ?? 's3';
  const { amz, short } = amzDate(input.now ?? new Date());
  const scope = `${short}/${input.creds.region}/${service}/aws4_request`;
  const query: Record<string, string> = {
    ...(input.extraQuery ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(input.expiresInSeconds)))),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonical = [
    (input.method ?? 'GET').toUpperCase(),
    input.path,
    canonicalQuery(query),
    `host:${input.host}\n`,
    'host',
    UNSIGNED,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonical)].join('\n');
  const signature = createHmac(
    'sha256',
    signingKey(input.creds.secretAccessKey, short, input.creds.region, service),
  )
    .update(toSign)
    .digest('hex');
  return `${input.protocolHost}${input.path}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

export { encodeKeyForUrl };
