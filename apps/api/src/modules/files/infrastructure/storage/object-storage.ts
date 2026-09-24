/**
 * ============================================================================
 *  Object storage port — the ONLY thing the rest of the app knows about
 * ============================================================================
 *
 * Cloudflare R2 today; AWS S3 or Azure Blob tomorrow. Nothing outside this
 * folder may import a concrete provider. Keys are identical everywhere, so a
 * provider move is: copy objects (scripts/storage-migrate.ts) → flip
 * STORAGE_PROVIDER. No code change, no link change.
 */
export type StorageProviderName = 'database' | 'r2' | 's3' | 'azure';

export interface PutOptions {
  contentType: string;
  /** Public assets: long cache (keys are content-versioned by query string). Private: no-store. */
  cacheControl?: string;
  contentDisposition?: string;
  sha256Hex?: string;
}

export interface SignedUrlOptions {
  expiresInSeconds: number;
  /** Forces the browser file name / inline vs download. */
  fileName?: string;
  download?: boolean;
  contentType?: string;
}

export interface ObjectStorage {
  readonly provider: StorageProviderName;
  readonly bucket: string;
  put(key: string, body: Buffer, opts: PutOptions): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  delete(key: string): Promise<void>;
  /** Short-lived URL for PRIVATE objects (documents). null if the provider can't sign (database → API streams it). */
  signedGetUrl(key: string, opts: SignedUrlOptions): Promise<string | null>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Retries transient failures (network, 429, 5xx) with jittered backoff. PUT of the same key is idempotent. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = !(e instanceof StorageError) || e.retryable;
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 200 * 2 ** i + Math.floor(Math.random() * 100)));
    }
  }
  throw last;
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
