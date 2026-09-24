import { describe, expect, it } from 'vitest';

import { checkSvgSafety, sniffMime } from '../domain/file-validation';
import { buildObjectKey, encodeKeyForUrl, sanitiseSegment } from '../infrastructure/storage/object-key';
import { presignUrl, signHeaders, EMPTY_SHA256 } from '../infrastructure/storage/sigv4';

// AWS's own published SigV4 examples ("Authenticating Requests: AWS Signature Version 4").
const AWS = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3' };
const T = new Date('2013-05-24T00:00:00Z');

describe('SigV4 (R2 / S3) — AWS published test vectors', () => {
  it('header auth: GET object with Range', () => {
    const h = signHeaders({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
      headers: { range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256, creds: AWS, now: T,
    });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('presigned URL: GET object, 24h', () => {
    const url = presignUrl({ protocolHost: 'https://examplebucket.s3.amazonaws.com', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', expiresInSeconds: 86400, creds: AWS, now: T });
    expect(url.endsWith('X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')).toBe(true);
  });
});

describe('object keys: {operator}/{folder}/...', () => {
  it('builds the operator-scoped layout', () => {
    expect(buildObjectKey({ tenantSlug: 'Orange-Travels', folder: 'branding', fileName: 'logo.svg' })).toBe('orange-travels/branding/logo.svg');
    expect(buildObjectKey({ prefix: 'prod', tenantSlug: 'orange-travels', folder: 'vehicles', sub: ['MH12AB1234', 'insurance'], fileName: 'abc.pdf' }))
      .toBe('prod/orange-travels/vehicles/MH12AB1234/insurance/abc.pdf');
  });
  it('cannot escape the operator folder (path traversal / injection)', () => {
    expect(() => buildObjectKey({ tenantSlug: '..', folder: 'kyc', fileName: 'x.pdf' })).toThrow();
    expect(buildObjectKey({ tenantSlug: 'a', folder: 'kyc', fileName: '../../other-operator/secret.pdf' })).toBe('a/kyc/other-operator-secret.pdf');
    expect(() => buildObjectKey({ tenantSlug: 'a', folder: 'evil' as never, fileName: 'x' })).toThrow();
    expect(sanitiseSegment('ब्रांड logo (1).svg')).toBe('logo-1.svg');
  });
  it('encodes keys for URLs segment by segment', () => {
    expect(encodeKeyForUrl('a b/c(1).pdf')).toBe('a%20b/c%281%29.pdf');
  });
});

describe('logo SVG safety', () => {
  const ok = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>');
  it('recognises SVG only when allowed', () => {
    expect(sniffMime(ok)).toBeNull();
    expect(sniffMime(ok, { allowSvg: true })).toBe('image/svg+xml');
  });
  it('accepts a clean logo', () => {
    expect(checkSvgSafety(ok)).toBeNull();
  });
  it('rejects every script vector', () => {
    for (const bad of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"></svg>',
      '<svg><a href="javascript:alert(1)">x</a></svg>',
      '<svg><foreignObject><div>x</div></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x "y">]><svg></svg>',
      '<svg><image href="https://evil.example/track.png"/></svg>',
      '<svg><iframe src="x"></iframe></svg>',
    ]) expect(checkSvgSafety(Buffer.from(bad))).not.toBeNull();
  });
  it('detects webp', () => {
    expect(sniffMime(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('image/webp');
  });
});
