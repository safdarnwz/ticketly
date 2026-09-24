import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, zodBody } from '@http';
import type { TripId } from '@kernel';

import { SeatQuotaService } from '../application/seat-quota.service';

const AllocateSchema = z.object({
  seatNumbers: z.array(z.string().trim().min(1)).min(1).max(60),
  holderType: z.enum(['agent', 'branch']),
  holderId: z.string().uuid(),
  /** Unsold seats return to general sale this many minutes before departure (30 min – 7 days). */
  releaseMinutesBefore: z.number().int().min(30).max(7 * 24 * 60),
});
const ReleaseSchema = z.object({ seatNumbers: z.array(z.string().trim().min(1)).min(1).max(60), reason: z.string().trim().min(5).max(200) });

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
  @ApiOperation({ summary: 'Reserve seats of this trip for one agent or branch (auto-released before departure)' })
  async allocate(@Param('tripId') tripId: string, @Body(zodBody(AllocateSchema)) dto: z.infer<typeof AllocateSchema>) {
    return this.quotas.allocate(tripId as TripId, dto);
  }

  @Get()
  @RequirePermission(Permission.INVENTORY_MANAGE)
  async list(@Param('tripId') tripId: string, @Query('all') all?: string) {
    return { items: await this.quotas.list(tripId as TripId, all !== '1') };
  }

  @Post('release')
  @HttpCode(200)
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Take allocated seats back into general sale now' })
  async release(@Param('tripId') tripId: string, @Body(zodBody(ReleaseSchema)) dto: z.infer<typeof ReleaseSchema>) {
    return this.quotas.release(tripId as TripId, dto.seatNumbers, dto.reason);
  }
}
