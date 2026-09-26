import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';
import { type TripId } from '@kernel';

import { IncidentService } from '../../incidents';
import { TrackingService } from '../../tracking';
import { CrewAppService } from '../application/services/crew-app.service';
import {
  CrewLostItemSchema,
  CrewPingSchema,
  CrewReportSchema,
  SosSchema,
  TicketScanSchema,
  TripStatusSchema,
  type CrewLostItemDto,
  type CrewPingDto,
  type CrewReportDto,
  type SosDto,
  type TicketScanDto,
  type TripStatusDto,
} from './dto/crew-app.dto';

/** Staff who run trips, or a crew login (own duties' trips only — checked per call). */
const RUN_TRIP = [Permission.TRIP_OPERATE, Permission.CREW_APP];

@ApiTags('crew-app')
@ApiBearerAuth('bearer')
@Controller({ path: 'crew', version: '1' })
@ApiStandardErrors()
export class CrewAppController {
  constructor(
    private readonly crew: CrewAppService,
    private readonly incidents: IncidentService,
    private readonly tracking: TrackingService,
  ) {}

  @Get('me')
  @RequirePermission(Permission.CREW_APP)
  @ApiOperation({ summary: 'Crew app: who I am and my duties from earlier today to 30 days ahead' })
  me() {
    return this.crew.myDay();
  }

  @Post('me/duties/:dutyId/attendance')
  @HttpCode(200)
  @RequirePermission(Permission.CREW_APP)
  @ApiOperation({
    summary: 'Crew app: mark myself present for one of my duties (late after 15 min)',
  })
  attendance(@UuidParam('dutyId') dutyId: string) {
    return this.crew.markMyAttendance(dutyId);
  }

  @Get('trips/:id/manifest')
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({ summary: 'Passenger manifest (boarding point, contact, ticket) for a trip' })
  async manifest(@UuidParam('id') id: string) {
    return { passengers: await this.crew.manifest(id as TripId) };
  }

  @Post('trips/:id/scan')
  @HttpCode(200)
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({ summary: 'Validate a boarding code and mark boarded' })
  async scan(@UuidParam('id') id: string, @Body(zodBody(TicketScanSchema)) dto: TicketScanDto) {
    return this.crew.scanBoarding(id as TripId, dto.boardingCode);
  }

  @Post('trips/:id/tickets/:ticketId/board')
  @HttpCode(200)
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({
    summary: 'Mark a passenger boarded from the manifest (after checking the PNR / ID)',
  })
  board(@UuidParam('id') id: string, @UuidParam('ticketId') ticketId: string) {
    return this.crew.boardTicket(id as TripId, ticketId);
  }

  @Post('trips/:id/status')
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({ summary: 'Start (depart) or close a trip' })
  async status(@UuidParam('id') id: string, @Body(zodBody(TripStatusSchema)) dto: TripStatusDto) {
    await this.crew.setTripStatus(id as TripId, dto.status);
    return { ok: true };
  }

  @Post('trips/:tripId/sos')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({
    summary:
      'Panic button from the crew app — one tap, location optional, alerts the emergency team at once',
  })
  async sos(@UuidParam('tripId') tripId: string, @Body(zodBody(SosSchema)) dto: SosDto) {
    await this.crew.assertOnTrip(tripId);
    return this.incidents.report({
      tripId,
      type: dto.kind,
      lat: dto.lat,
      lng: dto.lng,
      description: dto.description,
    });
  }

  @Post('trips/:tripId/incidents')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({
    summary:
      'Report from the road: breakdown, fuel, delay (reason + minutes; passengers are told), complaint / feedback, cleaning, maintenance',
  })
  async report(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(CrewReportSchema)) dto: CrewReportDto,
  ) {
    await this.crew.assertOnTrip(tripId);
    return this.incidents.report({ tripId, ...dto });
  }

  @Post('trips/:tripId/lost-found')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({ summary: 'Log an item left on this bus' })
  async lostItem(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(CrewLostItemSchema)) dto: CrewLostItemDto,
  ) {
    await this.crew.assertOnTrip(tripId);
    return this.incidents.logItem({ tripId, ...dto });
  }

  @Post('trips/:tripId/ping')
  @HttpCode(202)
  @RequirePermission(RUN_TRIP, 'any')
  @ApiOperation({
    summary: 'GPS fix from the crew phone while the bus is on the road (live tracking)',
  })
  async ping(@UuidParam('tripId') tripId: string, @Body(zodBody(CrewPingSchema)) dto: CrewPingDto) {
    await this.crew.assertOnTrip(tripId);
    return this.tracking.ingestPing({ tripId: tripId as TripId, ...dto });
  }
}
