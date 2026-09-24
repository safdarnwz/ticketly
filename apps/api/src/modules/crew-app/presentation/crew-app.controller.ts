import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';
import { type TripId } from '@kernel';

import { CrewAppService } from '../application/services/crew-app.service';

const ScanSchema = z.object({ boardingCode: z.string().min(3).max(40) });
const TripStatusSchema = z.object({ status: z.enum(['departed', 'closed']) });

@ApiTags('crew-app')
@ApiBearerAuth('bearer')
@Controller({ path: 'crew', version: '1' })
@ApiStandardErrors()
export class CrewAppController {
  constructor(private readonly crew: CrewAppService) {}

  @Get('trips/:id/manifest')
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Passenger manifest for a trip' })
  async manifest(@UuidParam('id') id: string) {
    return { passengers: await this.crew.manifest(id as TripId) };
  }

  @Post('trips/:id/scan')
  @HttpCode(200)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Validate a boarding code and mark boarded' })
  async scan(
    @UuidParam('id') id: string,
    @Body(zodBody(ScanSchema)) dto: z.infer<typeof ScanSchema>,
  ) {
    return this.crew.scanBoarding(id as TripId, dto.boardingCode);
  }

  @Post('trips/:id/status')
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Start (depart) or close a trip' })
  async status(
    @UuidParam('id') id: string,
    @Body(zodBody(TripStatusSchema)) dto: z.infer<typeof TripStatusSchema>,
  ) {
    await this.crew.setTripStatus(id as TripId, dto.status);
    return { ok: true };
  }
}
