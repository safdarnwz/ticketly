import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { AnnouncementController } from './presentation/announcement.controller';
import { AnnouncementRepository } from './infrastructure/persistence/announcement.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [AnnouncementController],
  providers: [AnnouncementRepository],
  exports: [AnnouncementRepository],
})
export class AnnouncementsModule {}
