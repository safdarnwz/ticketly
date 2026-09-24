import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { MasterDataModule } from '../master-data/master-data.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { PromotionController } from './presentation/promotion.controller';
import { PromotionRepository } from './infrastructure/persistence/promotion.repository';
import { PromotionService } from './application/services/promotion.service';

/**
 * Route-promotions ("Prio" sponsored-listings) — super-admin sets a
 * platform-wide rate card (daily/weekly/monthly x single/multi-route),
 * operators purchase promotion for their own routes, and SearchService
 * (search module) bubbles actively-promoted routes into the top of results
 * regardless of the customer's own sort/filter. Billing rides on the
 * existing platform_charges/settlement machinery rather than a parallel
 * billing pipeline.
 */
@Module({
  imports: [DatabaseModule, MasterDataModule, PlatformSettingsModule],
  controllers: [PromotionController],
  providers: [PromotionRepository, PromotionService],
  exports: [PromotionRepository, PromotionService],
})
export class PromotionsModule {}
