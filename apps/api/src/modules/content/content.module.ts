import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { FilesModule } from '../files/files.module';
import { ContentService } from './application/content.service';
import { AnnouncementRepository } from './infrastructure/announcement.repository';
import { ContentPageRepository } from './infrastructure/content-page.repository';
import { PromoContentRepository } from './infrastructure/promo-content.repository';
import { ContentAdminController } from './presentation/content-admin.controller';
import { ContentController } from './presentation/content.controller';

/**
 * Storefront content — platform-wide pages (including the legal pages the
 * Consumer Protection (E-Commerce) Rules 2020 / IT Rules 2021 require),
 * banners, offers and announcements.
 */
@Module({
  imports: [DatabaseModule, FilesModule],
  controllers: [ContentController, ContentAdminController],
  providers: [
    ContentService,
    ContentPageRepository,
    PromoContentRepository,
    AnnouncementRepository,
  ],
  exports: [ContentService],
})
export class ContentModule {}
