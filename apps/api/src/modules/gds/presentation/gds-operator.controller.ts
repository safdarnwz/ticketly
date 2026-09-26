import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { AppError, ErrorCode, type TripId } from '@kernel';
import { ApiStandardErrors, RequirePermission, UuidParam, zodBody } from '@http';

import { TripRepository } from '../../scheduling';
import { GdsService } from '../application/gds.service';
import {
  AgreementSchema,
  ClosedChannelsSchema,
  type AgreementDto,
  type ClosedChannelsDto,
} from './dto/gds.dto';

/** OPERATOR: choose which GDS partners may sell your seats and at what commission; channel-wise sales per trip. */
@ApiTags('gds-operator')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class GdsOperatorController {
  constructor(
    private readonly gds: GdsService,
    private readonly trips: TripRepository,
  ) {}

  @Get('gds-partners')
  @RequirePermission(Permission.TENANT_MANAGE)
  async partners() {
    return { items: await this.gds.partnersForOperator() };
  }

  @Put('gds-partners/:partnerId')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary: 'Start / pause distributing to a partner and set the commission you give it (0–30%)',
  })
  async agreement(
    @UuidParam('partnerId') partnerId: string,
    @Body(zodBody(AgreementSchema)) dto: AgreementDto,
  ) {
    await this.gds.setAgreement(partnerId, dto.status, dto.commissionPct);
    return { ok: true };
  }

  @Put('trips/:tripId/closed-channels')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({
    summary:
      'Channel-wise sales control for one trip (e.g. ["ota"] stops partner sales, web keeps selling)',
  })
  async channels(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(ClosedChannelsSchema)) dto: ClosedChannelsDto,
  ) {
    const trip = await this.trips.getById(tripId as TripId);
    if (
      !['scheduled', 'open', 'closed'].includes(trip.status) ||
      (await this.trips.hasRun(trip.id))
    )
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'This trip has left or was cancelled — its sales cannot change',
      });
    await this.trips.setClosedChannels(tripId as TripId, dto.closed);
    return { ok: true, closed: [...new Set(dto.closed)] };
  }
}
