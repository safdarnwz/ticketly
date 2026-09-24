import type { AppConfig } from '@config';
import type { DatabaseService } from '@database';

import { AzureBlobStorage } from './azure-blob.storage';
import { DatabaseStorage } from './database.storage';
import type { ObjectStorage } from './object-storage';
import { S3CompatibleStorage } from './s3-compatible.storage';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export type StorageSettings = AppConfig['storage'];

/** Build ANY provider from explicit settings — used by the app (current) and the migration script (source + target). */
export function createStorage(s: StorageSettings, db: DatabaseService): ObjectStorage {
  switch (s.provider) {
    case 'r2':
    case 's3':
      return new S3CompatibleStorage(s.provider, s.bucket, {
        endpoint: s.endpoint, region: s.provider === 'r2' ? (s.region || 'auto') : s.region,
        accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, forcePathStyle: s.forcePathStyle, timeoutMs: s.timeoutMs,
      });
    case 'azure':
      return new AzureBlobStorage(s.bucket, { account: s.azureAccount, accountKey: s.azureAccountKey, timeoutMs: s.timeoutMs, endpoint: s.endpoint || undefined });
    case 'database':
    default:
      return new DatabaseStorage(db);
  }
}
