import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, UuidParam, zodBody } from '@http';
import { type TripId } from '@kernel';

import { TrackingService } from '../application/services/tracking.service';
import { LocationPingSchema, type LocationPingDto } from './dto/tracking.dto';

@ApiTags('tracking')
@Controller({ path: 'tracking', version: '1' })
@ApiStandardErrors()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('ping')
  @HttpCode(202)
  @ApiBearerAuth('apiKey')
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Ingest a GPS ping (device/driver app)' })
  async ping(@Body(zodBody(LocationPingSchema)) dto: LocationPingDto) {
    return this.tracking.ingestPing(dto as never);
  }

  @Public()
  @Get('trips/:id/live')
  @ApiOperation({ summary: 'Live position & ETA for a trip (passenger tracking)' })
  async live(@UuidParam('id') id: string) {
    return this.tracking.liveState(id as TripId);
  }

  @Public()
  @Get('token/:token')
  @ApiOperation({
    summary:
      "A passenger's live bus location by their signed, PNR-tied tracking link — sent with the e-ticket, no login required",
  })
  async liveByToken(@Param('token') token: string) {
    return this.tracking.getLiveLocationByToken(token);
  }
}
