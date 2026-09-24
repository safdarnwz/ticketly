import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import type { TripId } from '@kernel';

import { SeatQuotaService } from '../application/seat-quota.service';
import {
  AllocateQuotaSchema,
  ListQuotasQuerySchema,
  ReleaseQuotaSchema,
  type AllocateQuotaDto,
  type ListQuotasQueryDto,
  type ReleaseQuotaDto,
} from './dto/seat-quota.dto';

@ApiTags('seat-quotas')
@ApiBearerAuth('bearer')
@Controller({ path: 'trips/:tripId/quotas', version: '1' })
@ApiStandardErrors()
export class SeatQuotaController {
  constructor(private readonly quotas: SeatQuotaService) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({
    summary: 'Reserve seats of this trip for one agent or branch (auto-released before departure)',
  })
  async allocate(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(AllocateQuotaSchema)) dto: AllocateQuotaDto,
  ) {
    return this.quotas.allocate(tripId as TripId, dto);
  }

  @Get()
  @RequirePermission(Permission.INVENTORY_MANAGE)
  async list(
    @UuidParam('tripId') tripId: string,
    @Query(zodQuery(ListQuotasQuerySchema)) q: ListQuotasQueryDto,
  ) {
    return { items: await this.quotas.list(tripId as TripId, !q.all) };
  }

  @Post('release')
  @HttpCode(200)
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Take allocated seats back into general sale now' })
  async release(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(ReleaseQuotaSchema)) dto: ReleaseQuotaDto,
  ) {
    return this.quotas.release(tripId as TripId, dto.seatNumbers, dto.reason);
  }
}
