import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RateLimit, RequirePermission, zodBody } from '@http';
import { getUserId, type TripId } from '@kernel';

import { DemandService } from '../application/demand.service';

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number');
const JoinSchema = z.object({
  fromStopId: z.string().uuid(),
  toStopId: z.string().uuid(),
  seatCount: z.number().int().min(1).max(6),
  contactPhone: phone,
  contactEmail: z.string().trim().email().optional(),
});
const LeaveSchema = z.object({ contactPhone: phone });

@ApiTags('demand')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class DemandController {
  constructor(private readonly demand: DemandService) {}

  @Post('trips/:tripId/waitlist')
  @HttpCode(201)
  @Public()
  @RateLimit(10, 60_000, 'ip')
  @ApiOperation({
    summary: 'Join the waitlist for a FULL trip segment (notified if seats free up)',
  })
  async join(
    @Param('tripId') tripId: string,
    @Body(zodBody(JoinSchema)) dto: z.infer<typeof JoinSchema>,
  ) {
    return this.demand.joinWaitlist(tripId as TripId, { ...dto, customerId: getUserId() ?? null });
  }

  @Post('trips/:tripId/waitlist/:id/leave')
  @HttpCode(200)
  @Public()
  @RateLimit(10, 60_000, 'ip')
  async leave(
    @Param('tripId') tripId: string,
    @Param('id') id: string,
    @Body(zodBody(LeaveSchema)) dto: z.infer<typeof LeaveSchema>,
  ) {
    return this.demand.leaveWaitlist(tripId as TripId, id, dto.contactPhone);
  }

  @Get('trips/:tripId/waitlist')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.BOOKING_READ)
  async list(@Param('tripId') tripId: string) {
    return { items: await this.demand.listWaitlist(tripId as TripId) };
  }

  @Get('trips/:tripId/occupancy-forecast')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary: 'Forecast final occupancy from the booking pace of recent comparable trips',
  })
  async forecast(@Param('tripId') tripId: string) {
    return this.demand.forecast(tripId as TripId);
  }

  @Get('reports/occupancy-forecast')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.REPORT_READ)
  async upcoming(@Query('days') days?: string) {
    return this.demand.upcomingForecast(Number(days) || 7);
  }
}
