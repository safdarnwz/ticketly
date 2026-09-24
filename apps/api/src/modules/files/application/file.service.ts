import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { AppError, ErrorCode, getUserId, newId } from '@kernel';
import { Logger } from '@observability';

import {
  checkSvgSafety,
  checkWordSafety,
  decodeBase64Upload,
  looksLikeVideo,
  safeFileName,
  sniffMime,
  type AllowedMime,
} from '../domain/file-validation';
import { allowedLabel, checkSize, policyFor, type UploadPurpose } from '../domain/upload-policy';
import {
  StoredFileRepository,
  type StoredFileMeta,
} from '../infrastructure/stored-file.repository';
import { buildObjectKey, encodeKeyForUrl, type Folder } from '../infrastructure/storage/object-key';
import { OBJECT_STORAGE } from '../infrastructure/storage/storage.factory';
import type { ObjectStorage } from '../infrastructure/storage/object-storage';

export interface StoreRequest {
  purpose: string;
  folder: Folder;
  /** Sub-folders under the operator's folder, e.g. ['MH12AB1234', 'insurance']. */
  sub?: string[];
  fileName?: string;
  /** Fixed object name (e.g. 'logo') — the extension is added from the real type. Default: a unique id. */
  fixedName?: string;
  contentBase64?: string;
  bytes?: Buffer;
  visibility: 'public' | 'private';
  allowSvg?: boolean;
  allowedMimes?: AllowedMime[];
}

/**
 * Upload → validate (real type from bytes, size, SVG safety) → put to the
 * configured object store under {operator}/{folder}/... → register the row.
 *
 * Order matters: the object is written FIRST and the row second. If the row
 * insert fails, the object is deleted best-effort; if the upload fails,
 * nothing is recorded. A registered row therefore always points at bytes.
 */
@Injectable()
export class FileService {
  private readonly log: Logger;

  constructor(
    private readonly files: StoredFileRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly config: AppConfig,
    logger: Logger,
  ) {
    this.log = logger.forContext('FileService');
  }

  async store(req: StoreRequest): Promise<StoredFileMeta & { url: string | null }> {
    let bytes = req.bytes;
    if (!bytes) {
      const decoded = decodeBase64Upload(req.contentBase64 ?? '');
      if (!decoded.ok)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: decoded.error });
      bytes = decoded.bytes;
    }
    const mime = sniffMime(bytes, { allowSvg: req.allowSvg });
    const allowed = req.allowedMimes ?? [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (!mime || !allowed.includes(mime)) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 415, {
        message: `Unsupported file. Allowed: ${allowed.map((m) => m.split('/')[1].replace('svg+xml', 'svg').toUpperCase()).join(', ')} (checked from the file's content, not its name)`,
      });
    }
    if (bytes.length > 5 * 1024 * 1024)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 413, { message: 'File is larger than 5 MB' });
    if (looksLikeVideo(bytes))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 415, {
        message: 'Video uploads are not allowed',
      });
    if (mime === 'image/svg+xml') {
      const unsafe = checkSvgSafety(bytes);
      if (unsafe) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: unsafe });
    }

    const id = newId();
    const displayName = safeFileName(req.fileName, mime);
    const ext = displayName.split('.').pop()!;
    const objectName = req.fixedName ? `${req.fixedName}.${ext}` : `${id}.${ext}`;
    const objectKey = buildObjectKey({
      prefix: this.config.storage.keyPrefix,
      tenantSlug: await this.files.tenantSlug(),
      folder: req.folder,
      sub: req.sub,
      fileName: objectName,
    });
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    await this.storage.put(objectKey, bytes, {
      contentType: mime,
      // Public assets are cache-busted by ?v=<hash> in their URL; private papers are never cached.
      cacheControl:
        req.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
      contentDisposition: `${mime.startsWith('application/') && mime !== 'application/pdf' ? 'attachment' : 'inline'}; filename="${displayName}"`,
    });
    try {
      // A fixed name (logo) re-uses its row so the registry never holds two rows for one object.
      const existing = req.fixedName
        ? await this.files.findByKey(this.storage.provider, this.storage.bucket, objectKey)
        : null;
      const rowId = existing?.id ?? id;
      await this.files.insert({
        id: rowId,
        purpose: req.purpose,
        provider: this.storage.provider,
        bucket: this.storage.bucket,
        objectKey,
        visibility: req.visibility,
        fileName: displayName,
        mimeType: mime,
        sizeBytes: bytes.length,
        sha256,
        uploadedBy: getUserId() ?? null,
      });
      const meta = (await this.files.get(rowId))!;
      return { ...meta, url: await this.urlFor(meta) };
    } catch (e) {
      if (!req.fixedName) await this.storage.delete(objectKey).catch(() => undefined);
      throw e;
    }
  }

  /**
   * THE upload entry point: purpose decides allowed types, size limit,
   * folder and public/private. Bytes arrive raw (no base64 inflation).
   */
  async upload(input: {
    purpose: UploadPurpose;
    bytes: Buffer;
    fileName?: string;
    sub?: string[];
    fixedName?: string;
  }): Promise<StoredFileMeta & { url: string | null }> {
    const policy = policyFor(input.purpose);
    if (!policy)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `Unknown upload purpose '${input.purpose}'`,
      });
    if (input.bytes?.length && looksLikeVideo(input.bytes)) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 415, {
        message: 'Video uploads are not allowed — please upload a photo or document instead',
      });
    }
    const sizeError = checkSize(policy, input.bytes?.length ?? 0);
    if (sizeError) throw new AppError(ErrorCode.COMMON_VALIDATION, 413, { message: sizeError });
    const mime = sniffMime(input.bytes, { allowSvg: policy.allowSvg });
    if (!mime || !policy.allowed.includes(mime)) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 415, {
        message: `${policy.label}: only ${allowedLabel(policy)} files are accepted (checked from the file's content, not its name)`,
      });
    }
    const wordIssue = checkWordSafety(input.bytes, mime);
    if (wordIssue) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: wordIssue });
    return this.store({
      purpose: input.purpose,
      folder: policy.folder,
      sub: input.sub,
      fileName: input.fileName,
      fixedName: input.fixedName,
      bytes: input.bytes,
      visibility: policy.visibility,
      allowSvg: policy.allowSvg,
      allowedMimes: [...policy.allowed],
    });
  }

  /** Load a file for attaching to something: it must exist in this scope and have been uploaded FOR that purpose. */
  async requireForPurpose(fileId: string, purpose: UploadPurpose): Promise<StoredFileMeta> {
    const meta = await this.files.get(fileId);
    if (!meta)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Uploaded file not found — please upload it again',
      });
    if (meta.purpose !== purpose) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `This file was uploaded as '${meta.purpose}', not '${purpose}'`,
      });
    }
    return meta;
  }

  async remove(fileId: string): Promise<void> {
    await this.files.softDelete(fileId);
  }

  async meta(id: string): Promise<StoredFileMeta | null> {
    return this.files.get(id);
  }

  /**
   * PUBLIC → CDN URL (Cloudflare custom domain) with a content-hash version,
   * so a replaced logo is never served stale from the edge cache.
   * PRIVATE → short-lived signed URL. null → stream through the API.
   */
  async urlFor(file: StoredFileMeta, opts: { download?: boolean } = {}): Promise<string | null> {
    this.assertReachable(file);
    if (
      file.visibility === 'public' &&
      this.config.storage.publicBaseUrl &&
      file.provider !== 'database'
    ) {
      return `${this.config.storage.publicBaseUrl}/${encodeKeyForUrl(file.objectKey)}?v=${file.sha256.slice(0, 12)}`;
    }
    if (
      file.visibility === 'public' &&
      (file.provider === 'database' || !this.config.storage.publicBaseUrl)
    ) {
      const signed =
        file.provider === 'database'
          ? null
          : await this.storage.signedGetUrl(file.objectKey, {
              expiresInSeconds: 3600,
              fileName: file.fileName,
              contentType: file.mimeType,
            });
      return (
        signed ??
        `${this.config.app.publicBaseUrl}/${this.config.app.apiPrefix}/v1/public/files/${file.id}?v=${file.sha256.slice(0, 12)}`
      );
    }
    return this.storage.signedGetUrl(file.objectKey, {
      expiresInSeconds: this.config.storage.signedUrlTtlSeconds,
      fileName: file.fileName,
      download: opts.download,
      contentType: file.mimeType,
    });
  }

  async read(file: StoredFileMeta): Promise<Buffer> {
    this.assertReachable(file);
    const bytes = await this.storage.get(file.objectKey);
    if (!bytes) {
      this.log.error(
        { fileId: file.id, key: file.objectKey, provider: file.provider },
        'registered object missing from storage',
      );
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'The file is missing from storage',
      });
    }
    return bytes;
  }

  /** A row still on the OLD provider mid-migration: tell the operator clearly instead of a cryptic 403 from the cloud. */
  private assertReachable(file: StoredFileMeta): void {
    if (file.provider !== this.storage.provider || file.bucket !== this.storage.bucket) {
      throw new AppError(ErrorCode.COMMON_INTERNAL, 503, {
        message: 'This file is being moved to new storage — please try again shortly',
        retryable: true,
        details: { fileProvider: file.provider, activeProvider: this.storage.provider },
      });
    }
  }
}
