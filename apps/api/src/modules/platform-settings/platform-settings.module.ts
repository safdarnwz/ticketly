import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';

import { PlatformSettingsRepository } from './infrastructure/platform-settings.repository';
import { PlatformPoliciesService } from './platform-policies.service';

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
 * `PlatformPoliciesService` (password policy, admin IP allowlist, GST slabs,
 * agent credit and retention policies) lives here for the same reason: IAM,
 * agents and the worker all read it.
 */
@Module({
  imports: [DatabaseModule, CacheModule],
  providers: [PlatformSettingsRepository, PlatformPoliciesService],
  exports: [PlatformSettingsRepository, PlatformPoliciesService],
})
export class PlatformSettingsModule {}
