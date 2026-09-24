import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, zodBody } from '@http';
import { type TripId } from '@kernel';

import { DepartureControlService } from '../application/services/departure-control.service';
import { ChartTripSchema, type ChartTripDto } from './dto/departure-control.dto';

/**
 * Departure control (DCS) endpoints — charting a trip at departure and reading
 * the closeout. Used by operations / the conductor closeout flow.
 */
@ApiTags('departure-control')
@ApiBearerAuth('bearer')
@Controller({ path: 'trips', version: '1' })
@ApiStandardErrors()
export class DepartureControlController {
  constructor(private readonly dcs: DepartureControlService) {}

  @Post(':tripId/chart')
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Chart a trip at departure (seat + cash reconciliation)' })
  async chart(@Param('tripId') tripId: string, @Body(zodBody(ChartTripSchema)) dto: ChartTripDto) {
    return this.dcs.chart(tripId as TripId, dto);
  }

  @Get(':tripId/chart')
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Read a trip chart (closeout record)' })
  async getChart(@Param('tripId') tripId: string) {
    return this.dcs.getChart(tripId as TripId);
  }
}
