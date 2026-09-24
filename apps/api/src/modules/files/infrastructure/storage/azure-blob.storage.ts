import { createHmac } from 'node:crypto';

import { encodeKeyForUrl } from './object-key';
import { isRetryableStatus, StorageError, withRetry, type ObjectStorage, type PutOptions, type SignedUrlOptions } from './object-storage';

/**
 * Azure Blob Storage — Shared Key auth for server calls, Service SAS for
 * short-lived download links. Same keys as R2/S3 (container = bucket), so a
 * move to Azure is a copy + config flip.
 */
const API_VERSION = '2021-08-06';

export class AzureBlobStorage implements ObjectStorage {
  readonly provider = 'azure' as const;
  private readonly key: Buffer;

  constructor(readonly bucket: string, private readonly cfg: { account: string; accountKey: string; timeoutMs: number; endpoint?: string }) {
    if (!bucket || !cfg.account || !cfg.accountKey) {
      throw new Error("Storage provider 'azure' needs STORAGE_BUCKET (container), STORAGE_AZURE_ACCOUNT and STORAGE_AZURE_ACCOUNT_KEY");
    }
    this.key = Buffer.from(cfg.accountKey, 'base64');
  }

  private base(): string {
    return (this.cfg.endpoint || `https://${this.cfg.account}.blob.core.windows.net`).replace(/\/+$/, '');
  }

  private path(key: string): string {
    return `/${this.bucket}/${encodeKeyForUrl(key)}`;
  }

  /** Shared Key signature (Blob service, version 2009-09-19+ string-to-sign). */
  sharedKey(method: string, path: string, headers: Record<string, string>): string {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const contentLength = h['content-length'] && h['content-length'] !== '0' ? h['content-length'] : '';
    const canonHeaders = Object.keys(h).filter((k) => k.startsWith('x-ms-')).sort().map((k) => `${k}:${h[k]}\n`).join('');
    const toSign = [
      method, h['content-encoding'] ?? '', h['content-language'] ?? '', contentLength, h['content-md5'] ?? '',
      h['content-type'] ?? '', '', h['if-modified-since'] ?? '', h['if-match'] ?? '', h['if-none-match'] ?? '',
      h['if-unmodified-since'] ?? '', h['range'] ?? '',
    ].join('\n') + '\n' + canonHeaders + `/${this.cfg.account}${path}`;
    return `SharedKey ${this.cfg.account}:${createHmac('sha256', this.key).update(toSign, 'utf8').digest('base64')}`;
  }

  private async send(method: string, key: string, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
    const path = this.path(key);
    const headers: Record<string, string> = { ...extra, 'x-ms-date': new Date().toUTCString(), 'x-ms-version': API_VERSION };
    if (body) headers['content-length'] = String(body.length);
    headers.authorization = this.sharedKey(method, path, headers);
    try {
      return await fetch(`${this.base()}${path}`, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(this.cfg.timeoutMs) });
    } catch (e) {
      throw new StorageError(`azure ${method} ${key} failed: ${(e as Error).message}`, undefined, true);
    }
  }

  async put(key: string, body: Buffer, opts: PutOptions): Promise<void> {
    await withRetry(async () => {
      const headers: Record<string, string> = { 'content-type': opts.contentType, 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': opts.contentType };
      if (opts.cacheControl) headers['x-ms-blob-cache-control'] = opts.cacheControl;
      if (opts.contentDisposition) headers['x-ms-blob-content-disposition'] = opts.contentDisposition;
      const res = await this.send('PUT', key, body, headers);
      if (!res.ok) throw new StorageError(`azure PUT ${key} → ${res.status}`, res.status, isRetryableStatus(res.status));
    });
  }

  async get(key: string): Promise<Buffer | null> {
    return withRetry(async () => {
      const res = await this.send('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new StorageError(`azure GET ${key} → ${res.status}`, res.status, isRetryableStatus(res.status));
      return Buffer.from(await res.arrayBuffer());
    });
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    return withRetry(async () => {
      const res = await this.send('HEAD', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new StorageError(`azure HEAD ${key} → ${res.status}`, res.status, isRetryableStatus(res.status));
      return { sizeBytes: Number(res.headers.get('content-length') ?? 0) };
    });
  }

  async delete(key: string): Promise<void> {
    await withRetry(async () => {
      const res = await this.send('DELETE', key);
      if (!res.ok && res.status !== 404) throw new StorageError(`azure DELETE ${key} → ${res.status}`, res.status, isRetryableStatus(res.status));
    });
  }

  /** Read-only Service SAS for one blob, HTTPS only. */
  async signedGetUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    const path = this.path(key);
    const now = new Date(Date.now() - 60_000); // clock-skew tolerance
    const exp = new Date(Date.now() + opts.expiresInSeconds * 1000);
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rscd = opts.fileName ? `${opts.download ? 'attachment' : 'inline'}; filename="${opts.fileName.replace(/["\\\r\n]/g, '_')}"` : '';
    const rsct = opts.contentType ?? '';
    const canonicalResource = `/blob/${this.cfg.account}${decodeURIComponent(path)}`;
    const toSign = ['r', iso(now), iso(exp), canonicalResource, '', '', 'https', API_VERSION, 'b', '', '', '', rscd, '', '', rsct].join('\n');
    const sig = createHmac('sha256', this.key).update(toSign, 'utf8').digest('base64');
    const q = new URLSearchParams({ sp: 'r', st: iso(now), se: iso(exp), spr: 'https', sv: API_VERSION, sr: 'b', sig });
    if (rscd) q.set('rscd', rscd);
    if (rsct) q.set('rsct', rsct);
    return `${this.base()}${path}?${q.toString()}`;
  }
}
