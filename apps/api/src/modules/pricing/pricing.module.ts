import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';

import { SchedulingModule } from '../scheduling/scheduling.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { CouponRepository } from './infrastructure/persistence/coupon.repository';
import { FareRepository } from './infrastructure/persistence/fare.repository';
import { PricingController } from './presentation/pricing.controller';
import { PricingService } from './application/services/pricing.service';

/**
 * Pricing: fare plans/rules, dynamic-pricing (yield) policies, coupons, and the
 * short-lived quote endpoint. The PricingEngine itself is pure domain code
 * (domain/pricing-engine.ts) exercised by unit tests; this module wires the
 * repositories and the quote flow.
 *
 * Imports the standalone `PlatformSettingsModule` (not `TenancyModule`) for
 * the government-mandated GST rate — `TenancyModule` imports `BookingModule`,
 * which imports `PricingModule`, so importing `TenancyModule` here would
 * cycle straight back.
 *
 * Exports the pieces booking (Part 7) needs: to re-price a quote and to redeem
 * a coupon atomically inside the booking transaction.
 */
@Module({
  imports: [DatabaseModule, CacheModule, SchedulingModule, MasterDataModule, PlatformSettingsModule],
  controllers: [PricingController],
  providers: [FareRepository, CouponRepository, PricingService],
  exports: [FareRepository, CouponRepository, PricingService],
})
export class PricingModule {}
