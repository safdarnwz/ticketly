import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { CrewAppController } from './presentation/crew-app.controller';
import { CrewLoginController } from './presentation/crew-login.controller';
import { FleetModule } from '../fleet/fleet.module';
import { IamModule } from '../iam/iam.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TrackingModule } from '../tracking/tracking.module';
import { CrewAppService } from './application/services/crew-app.service';
import { BookingModule } from '../booking/booking.module';
import { SchedulingModule } from '../scheduling/scheduling.module';

@Module({
  imports: [
    DatabaseModule,
    MessagingModule,
    BookingModule,
    SchedulingModule,
    FleetModule,
    IamModule,
    IncidentsModule,
    TrackingModule,
    PlatformSettingsModule,
  ],
  controllers: [CrewAppController, CrewLoginController],
  providers: [CrewAppService],
  exports: [CrewAppService],
})
export class CrewAppModule {}
