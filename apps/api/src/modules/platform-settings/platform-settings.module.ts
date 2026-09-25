import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';

import { PlatformSettingsRepository } from './infrastructure/platform-settings.repository';
import { PlatformBillingService } from './application/platform-billing.service';
import { PlatformPoliciesService } from './application/platform-policies.service';
import { PlatformChargeRepository } from './infrastructure/platform-charge.repository';
import { DataRetentionService } from './application/data-retention.service';
import { RetentionPurgeRepository } from './infrastructure/retention-purge.repository';
import { PlatformPoliciesController } from './presentation/platform-policies.controller';

/**
 * Deliberately standalone — depends on nothing but DatabaseModule/CacheModule,
 * so ANY module can import it with zero circular-dependency risk. This
 * exists because `PricingModule` needs `PlatformSettingsRepository` (for the
 * government-mandated GST rate) but importing the full `TenancyModule` would
 * create a cycle: TenancyModule → BookingModule → PricingModule → TenancyModule.
 * (PaymentModule and FleetModule also use PlatformSettingsRepository, but
 * importing TenancyModule directly is safe for them — BookingModule doesn't
 * import either back — so they're left as-is; this module exists purely to
 * break the one cycle that mattered.)
 *
 * Platform charges (`PlatformChargeRepository`, `PlatformBillingService`)
 * live here too: settlement, promotions, fleet and notifications all write
 * them.
 *
 * `PlatformPoliciesService` (password policy, admin IP allowlist, GST slabs,
 * agent credit and retention policies) lives here for the same reason: IAM,
 * agents and the worker all read it.
 */
@Module({
  imports: [DatabaseModule, CacheModule],
  controllers: [PlatformPoliciesController],
  providers: [
    PlatformSettingsRepository,
    PlatformChargeRepository,
    PlatformBillingService,
    PlatformPoliciesService,
    RetentionPurgeRepository,
    DataRetentionService,
  ],
  exports: [
    PlatformSettingsRepository,
    PlatformChargeRepository,
    PlatformBillingService,
    PlatformPoliciesService,
    DataRetentionService,
  ],
})
export class PlatformSettingsModule {}
