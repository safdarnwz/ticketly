import { Module } from '@nestjs/common';

import { CacheModule } from '@cache';
import { ConfigModule } from '@config';
import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { FleetModule } from '../fleet/fleet.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { InventoryRepository } from './infrastructure/persistence/inventory.repository';
import { MaterializationService } from './application/services/materialization.service';
import { SchedulingController } from './presentation/scheduling.controller';
import { SchedulingService } from './application/services/scheduling.service';
import { ServiceRepository } from './infrastructure/persistence/service.repository';
import { TripRepository } from './infrastructure/persistence/trip.repository';

/**
 * Scheduling & segment-wise inventory. Depends on master data (routes, layouts,
 * vehicle types) and fleet (road-legality). Exports the trip + inventory
 * repositories that search (Part 6) and booking (Part 7) build on.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    CacheModule,
    MessagingModule,
    MasterDataModule,
    FleetModule,
  ],
  controllers: [SchedulingController],
  providers: [
    ServiceRepository,
    TripRepository,
    InventoryRepository,
    MaterializationService,
    SchedulingService,
  ],
  exports: [ServiceRepository, TripRepository, InventoryRepository, MaterializationService],
})
export class SchedulingModule {}
