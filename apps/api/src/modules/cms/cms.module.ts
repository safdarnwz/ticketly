import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';

import { DatabaseModule } from '@database';

import { CmsController } from './presentation/cms.controller';
import { CmsRepository } from './infrastructure/persistence/cms.repository';
import { CmsService } from './application/services/cms.service';

/**
 * Storefront CMS + offers (Part 14). Content pages, promotional banners and
 * marketing offers, each surfaced only within its validity window. Read
 * endpoints are public storefront content; management is operator-gated.
 */
@Module({
  imports: [DatabaseModule, FilesModule],
  controllers: [CmsController],
  providers: [CmsRepository, CmsService],
  exports: [CmsService],
})
export class CmsModule {}
