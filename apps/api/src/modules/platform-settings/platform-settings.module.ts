import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';

import { PlatformSettingsRepository } from '../tenancy/infrastructure/persistence/platform-settings.repository';

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
 */
@Module({
  imports: [DatabaseModule, CacheModule],
  providers: [PlatformSettingsRepository],
  exports: [PlatformSettingsRepository],
})
export class PlatformSettingsModule {}
