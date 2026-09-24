import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';

import { MasterDataModule } from '../master-data/master-data.module';
import { PricingModule } from '../pricing/pricing.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SearchController } from './presentation/search.controller';
import { SearchService } from './application/services/search.service';

/**
 * Search — the sub-10ms hot path. Aggregates across every active tenant (see
 * SearchService), so it also depends on TenancyModule (the tenant list +
 * display names) alongside master data (routes), scheduling (trips + the
 * leg-bitmap availability read model) and pricing (fares + yield).
 * Everything it touches is cache-backed, and the whole result is cached with
 * single-flight so a burst of identical searches collapses to one compute.
 * PromotionsModule is imported for the sponsored-listing ("Prio" badge)
 * top-3 bubbling — no risk of the circular-dependency PricingModule's own
 * comment warns about, since PromotionsModule only depends on
 * DatabaseModule/MasterDataModule, neither of which cycles back here.
 */
@Module({
  imports: [
    DatabaseModule,
    CacheModule,
    MasterDataModule,
    SchedulingModule,
    PricingModule,
    TenancyModule,
    PromotionsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
