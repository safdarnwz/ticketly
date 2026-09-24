import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';

import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AncillaryController } from './presentation/ancillary.controller';
import { AncillaryService } from './application/services/ancillary.service';
import { BookingModule } from '../booking/booking.module';
import { AncillaryRepository } from './infrastructure/persistence/ancillary.repository';

/**
 * Add-on services (insurance, meals, luggage) a passenger can attach to a
 * booking — split out into its own module from what used to be a combined
 * "loyalty" module, since ancillaries have nothing to do with loyalty
 * points/referrals (both removed from the product) and were only ever
 * bundled in the same folder as a matter of convenience.
 */
@Module({
  imports: [DatabaseModule, BookingModule, PlatformSettingsModule],
  controllers: [AncillaryController],
  providers: [AncillaryRepository, AncillaryService],
  exports: [AncillaryService],
})
export class AncillaryModule {}
