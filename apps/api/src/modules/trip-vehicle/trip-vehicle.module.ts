import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { FleetModule } from '../fleet/fleet.module';
import { MasterDataModule } from '../master-data/master-data.module';
import { TripVehicleService } from './application/trip-vehicle.service';
import { TripVehicleRepository } from './infrastructure/trip-vehicle.repository';
import { TripVehicleController } from './presentation/trip-vehicle.controller';

/** Change the bus assigned to a trip, with automatic passenger re-seating. */
@Module({
  imports: [DatabaseModule, MessagingModule, FleetModule, MasterDataModule],
  controllers: [TripVehicleController],
  providers: [TripVehicleService, TripVehicleRepository],
})
export class TripVehicleModule {}
