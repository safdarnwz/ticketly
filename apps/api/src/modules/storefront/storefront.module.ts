import { Module } from '@nestjs/common';

import { SearchModule } from '../search/search.module';
import { StorefrontController } from './presentation/storefront.controller';
import { StorefrontService } from './application/services/storefront.service';

/**
 * Storefront (Part 14). The traveller-facing layer over trip search: filtered +
 * sorted results, round-trip, and connecting journeys via a hub. All decision
 * logic (filtering, sorting, connection building) is pure and unit-tested in
 * domain/; this module just orchestrates the underlying searches.
 */
@Module({
  imports: [SearchModule],
  controllers: [StorefrontController],
  providers: [StorefrontService],
  exports: [StorefrontService],
})
export class StorefrontModule {}
