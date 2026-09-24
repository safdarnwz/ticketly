import { Module } from '@nestjs/common';

import { AppConfig } from '@config';
import { DatabaseModule, DatabaseService } from '@database';

import { FileService } from './application/file.service';
import { StoredFileRepository } from './infrastructure/stored-file.repository';
import { OBJECT_STORAGE, createStorage } from './infrastructure/storage/storage.factory';
import { FileController } from './presentation/file.controller';

/**
 * Files & object storage. The concrete provider (Cloudflare R2 / AWS S3 /
 * Azure Blob / database) is chosen ONCE here from STORAGE_PROVIDER; every
 * other module depends only on FileService.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [FileController],
  providers: [
    StoredFileRepository,
    {
      provide: OBJECT_STORAGE,
      useFactory: (config: AppConfig, db: DatabaseService) => createStorage(config.storage, db),
      inject: [AppConfig, DatabaseService],
    },
    FileService,
  ],
  exports: [StoredFileRepository, FileService, OBJECT_STORAGE],
})
export class FilesModule {}
