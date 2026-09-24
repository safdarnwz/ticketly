import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { CrewRepository } from './infrastructure/persistence/crew.repository';
import { CrewService } from './application/services/crew.service';
import { FleetController } from './presentation/fleet.controller';
import { FleetLogsRepository } from './infrastructure/persistence/logs.repository';
import { FleetService } from './application/services/fleet.service';
import { VehicleRepository } from './infrastructure/persistence/vehicle.repository';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { FilesModule } from '../files/files.module';
import { VehicleVerificationService } from './application/services/vehicle-verification.service';
import { VehicleAdminController } from './presentation/vehicle-admin.controller';

/**
 * Fleet & crew. Exposes the two guards scheduling (Part 5) depends on:
 *   - FleetService.isRoadLegalOn  → never schedule an uninsured/expired bus
 *   - CrewService.assignDuty      → never double-book or over-drive a crew
 *
 * Imports PlatformSettingsModule for PlatformSettingsRepository — vehicle
 * registration charges the one-time per-bus platform fee (see
 * FleetController.createVehicle).
 */
@Module({
  imports: [DatabaseModule, MessagingModule, PlatformSettingsModule, FilesModule],
  controllers: [FleetController, VehicleAdminController],
  providers: [
    VehicleRepository,
    CrewRepository,
    FleetLogsRepository,
    FleetService,
    CrewService,
    VehicleVerificationService,
  ],
  exports: [
    VehicleRepository,
    CrewRepository,
    FleetService,
    CrewService,
    VehicleVerificationService,
  ],
})
export class FleetModule {}
