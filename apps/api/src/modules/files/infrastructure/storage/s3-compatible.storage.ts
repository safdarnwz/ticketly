import { encodeKeyForUrl } from './object-key';
import {
  isRetryableStatus,
  StorageError,
  withRetry,
  type ObjectStorage,
  type PutOptions,
  type SignedUrlOptions,
  type StorageProviderName,
} from './object-storage';
import { presignUrl, sha256Hex, signHeaders, type SigV4Creds } from './sigv4';

/**
 * Cloudflare R2 and AWS S3 (and any S3-compatible store) — one adapter, the
 * S3 REST API signed with SigV4. R2: endpoint https://<account>.r2.cloudflarestorage.com,
 * region 'auto', path-style. S3: endpoint https://s3.<region>.amazonaws.com.
 */
export class S3CompatibleStorage implements ObjectStorage {
  private readonly creds: SigV4Creds;
  private readonly origin: URL;

  constructor(
    readonly provider: Extract<StorageProviderName, 'r2' | 's3'>,
    readonly bucket: string,
    private readonly cfg: {
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
      timeoutMs: number;
    },
  ) {
    if (!bucket || !cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new Error(
        `Storage provider '${provider}' needs STORAGE_BUCKET, STORAGE_ENDPOINT, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY`,
      );
    }
    this.creds = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      region: cfg.region || 'auto',
      service: 's3',
    };
    this.origin = new URL(cfg.endpoint);
  }

  /** host + path for a key, honouring path-style vs virtual-hosted addressing. */
  locate(key: string): { host: string; path: string; base: string } {
    const encoded = encodeKeyForUrl(key);
    if (this.cfg.forcePathStyle) {
      return {
        host: this.origin.host,
        path: `/${this.bucket}/${encoded}`,
        base: `${this.origin.protocol}//${this.origin.host}`,
      };
    }
    const host = `${this.bucket}.${this.origin.host}`;
    return { host, path: `/${encoded}`, base: `${this.origin.protocol}//${host}` };
  }

  private async send(
    method: string,
    key: string,
    body?: Buffer,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { host, path, base } = this.locate(key);
    const payloadHash = body ? sha256Hex(body) : sha256Hex('');
    const headers = signHeaders({
      method,
      host,
      path,
      headers: extraHeaders,
      payloadHash,
      creds: this.creds,
    });
    delete headers.host; // fetch sets Host itself
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (e) {
      throw new StorageError(
        `${this.provider} ${method} ${key} failed: ${(e as Error).message}`,
        undefined,
        true,
      );
    }
    return res;
  }

  async put(key: string, body: Buffer, opts: PutOptions): Promise<void> {
    await withRetry(async () => {
      const headers: Record<string, string> = {
        'content-type': opts.contentType,
        'content-length': String(body.length),
      };
      if (opts.cacheControl) headers['cache-control'] = opts.cacheControl;
      if (opts.contentDisposition) headers['content-disposition'] = opts.contentDisposition;
      const res = await this.send('PUT', key, body, headers);
      if (!res.ok)
        throw new StorageError(
          `${this.provider} PUT ${key} → ${res.status} ${await res.text().catch(() => '')}`.slice(
            0,
            500,
          ),
          res.status,
          isRetryableStatus(res.status),
        );
    });
  }

  async get(key: string): Promise<Buffer | null> {
    return withRetry(async () => {
      const res = await this.send('GET', key);
      if (res.status === 404) return null;
      if (!res.ok)
        throw new StorageError(
          `${this.provider} GET ${key} → ${res.status}`,
          res.status,
          isRetryableStatus(res.status),
        );
      return Buffer.from(await res.arrayBuffer());
    });
  }

  async head(key: string): Promise<{ sizeBytes: number } | null> {
    return withRetry(async () => {
      const res = await this.send('HEAD', key);
      if (res.status === 404) return null;
      if (!res.ok)
        throw new StorageError(
          `${this.provider} HEAD ${key} → ${res.status}`,
          res.status,
          isRetryableStatus(res.status),
        );
      return { sizeBytes: Number(res.headers.get('content-length') ?? 0) };
    });
  }

  async delete(key: string): Promise<void> {
    await withRetry(async () => {
      const res = await this.send('DELETE', key);
      // S3/R2 return 204 even for missing keys — delete is idempotent.
      if (!res.ok && res.status !== 404)
        throw new StorageError(
          `${this.provider} DELETE ${key} → ${res.status}`,
          res.status,
          isRetryableStatus(res.status),
        );
    });
  }

  async signedGetUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    const { host, path, base } = this.locate(key);
    const extra: Record<string, string> = {};
    if (opts.fileName) {
      const safe = opts.fileName.replace(/["\\\r\n]/g, '_');
      extra['response-content-disposition'] =
        `${opts.download ? 'attachment' : 'inline'}; filename="${safe}"`;
    }
    if (opts.contentType) extra['response-content-type'] = opts.contentType;
    return presignUrl({
      protocolHost: base,
      host,
      path,
      expiresInSeconds: opts.expiresInSeconds,
      extraQuery: extra,
      creds: this.creds,
    });
  }
}
