import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, UuidParam, zodBody } from '@http';
import type { TripId, VehicleId } from '@kernel';

import { TripVehicleService } from '../application/trip-vehicle.service';
import { ChangeVehicleSchema, type ChangeVehicleDto } from './dto/trip-vehicle.dto';

@ApiTags('trips')
@ApiBearerAuth('bearer')
@Controller({ path: 'trips/:tripId/vehicle', version: '1' })
@ApiStandardErrors()
export class TripVehicleController {
  constructor(private readonly svc: TripVehicleService) {}

  @Post()
  @HttpCode(200)
  @Idempotent()
  @RequirePermission(Permission.TRIP_MANAGE)
  @ApiOperation({
    summary:
      'Change the bus of a trip; passengers are re-seated on the same seat type if the layout differs',
  })
  async change(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(ChangeVehicleSchema)) dto: ChangeVehicleDto,
  ) {
    return this.svc.changeVehicle(tripId as TripId, {
      vehicleId: dto.vehicleId as VehicleId,
      reason: dto.reason,
    });
  }

  @Get('history')
  @RequirePermission(Permission.TRIP_MANAGE)
  async history(@UuidParam('tripId') tripId: string) {
    return { items: await this.svc.history(tripId as TripId) };
  }
}
