import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, zodBody } from '@http';
import { type TripId } from '@kernel';

import { TrackingService } from '../application/services/tracking.service';

const PingSchema = z.object({
  tripId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmph: z.number().min(0).max(200),
  headingDeg: z.number().min(0).max(360).optional(),
  distanceCoveredM: z.number().int().min(0),
});

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
  async ping(@Body(zodBody(PingSchema)) dto: z.infer<typeof PingSchema>) {
    return this.tracking.ingestPing(dto as never);
  }

  @Public()
  @Get('trips/:id/live')
  @ApiOperation({ summary: 'Live position & ETA for a trip (passenger tracking)' })
  async live(@Param('id') id: string) {
    return this.tracking.liveState(id as TripId);
  }

  @Public()
  @Get('token/:token')
  @ApiOperation({ summary: "A passenger's live bus location by their signed, PNR-tied tracking link — sent with the e-ticket, no login required" })
  async liveByToken(@Param('token') token: string) {
    return this.tracking.getLiveLocationByToken(token);
  }
}
