import { Module } from '@nestjs/common';

import { DatabaseModule } from '@database';
import { MessagingModule } from '@messaging';

import { IncidentService } from './application/incident.service';
import { IncidentRepository } from './infrastructure/incident.repository';
import { IncidentController } from './presentation/incident.controller';
import { BranchesModule } from '../branches/branches.module';

/** Incidents (SOS, breakdown, delay, diversion…), lost & found, shift handover, dispatch reports. */
@Module({
  imports: [DatabaseModule, MessagingModule, BranchesModule],
  controllers: [IncidentController],
  providers: [IncidentService, IncidentRepository],
  exports: [IncidentService],
})
export class IncidentsModule {}
