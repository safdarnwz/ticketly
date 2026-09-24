import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { MasterDataController } from './presentation/master-data.controller';
import { AmenityRepository } from './infrastructure/persistence/amenity.repository';
import { VehicleTypeRepository } from './infrastructure/persistence/vehicle-type.repository';
import { GeographyRepository } from './infrastructure/persistence/geography.repository';
import { StopRepository } from './infrastructure/persistence/stop.repository';
import { RouteRepository } from './infrastructure/persistence/route.repository';
import { RouteService } from './application/services/route.service';
import { SeatLayoutRepository } from './infrastructure/persistence/seat-layout.repository';
import { SeatLayoutService } from './application/services/seat-layout.service';

/**
 * Master data: geography, stops, seat layouts, vehicle types, amenities and
 * routes. Everything here is reference data the later parts read on the hot
 * path, so the repositories are cache-backed and the domain models
 * (SeatMap, RoutePath) guarantee validity.
 *
 * Exports the repositories that Parts 4–6 consume (fleet binds vehicle types &
 * seat layouts; scheduling reads routes; search reads geography & routes).
 */
@Module({
  imports: [DatabaseModule, CacheModule, MessagingModule],
  controllers: [MasterDataController],
  providers: [
    GeographyRepository,
    StopRepository,
    SeatLayoutRepository,
    SeatLayoutService,
    VehicleTypeRepository,
    AmenityRepository,
    RouteRepository,
    RouteService,
  ],
  exports: [
    GeographyRepository,
    StopRepository,
    SeatLayoutRepository,
    VehicleTypeRepository,
    AmenityRepository,
    RouteRepository,
  ],
})
export class MasterDataModule {}
