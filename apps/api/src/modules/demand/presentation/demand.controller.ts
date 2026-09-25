import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Public,
  RateLimit,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { getUserId, type TripId } from '@kernel';

import { DemandService } from '../application/demand.service';
import {
  CancelSuggestionQuerySchema,
  ForecastQuerySchema,
  SuggestionDecisionSchema,
  type CancelSuggestionQueryDto,
  type SuggestionDecisionDto,
  JoinDemandListSchema,
  LeaveDemandListSchema,
  type ForecastQueryDto,
  type JoinDemandListDto,
  type LeaveDemandListDto,
} from './dto/demand.dto';

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
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(JoinDemandListSchema)) dto: JoinDemandListDto,
  ) {
    return this.demand.joinWaitlist(tripId as TripId, { ...dto, customerId: getUserId() ?? null });
  }

  @Post('trips/:tripId/waitlist/:id/leave')
  @HttpCode(200)
  @Public()
  @RateLimit(10, 60_000, 'ip')
  async leave(
    @UuidParam('tripId') tripId: string,
    @UuidParam('id') id: string,
    @Body(zodBody(LeaveDemandListSchema)) dto: LeaveDemandListDto,
  ) {
    return this.demand.leaveWaitlist(tripId as TripId, id, dto.contactPhone);
  }

  @Get('trips/:tripId/waitlist')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.BOOKING_READ)
  async list(@UuidParam('tripId') tripId: string) {
    return { items: await this.demand.listWaitlist(tripId as TripId) };
  }

  @Get('trips/:tripId/occupancy-forecast')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.REPORT_READ)
  @ApiOperation({
    summary: 'Forecast final occupancy from the booking pace of recent comparable trips',
  })
  async forecast(@UuidParam('tripId') tripId: string) {
    return this.demand.forecast(tripId as TripId);
  }

  @Get('reports/occupancy-forecast')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.REPORT_READ)
  async upcoming(@Query(zodQuery(ForecastQuerySchema)) q: ForecastQueryDto) {
    return this.demand.upcomingForecast(q.days);
  }

  @Get('reports/cancel-suggestions')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Upcoming trips forecast to run nearly empty — candidates to cancel or merge (decided ones are left out)',
  })
  async cancelSuggestions(
    @Query(zodQuery(CancelSuggestionQuerySchema)) q: CancelSuggestionQueryDto,
  ) {
    return this.demand.cancelSuggestions(q.days, q.maxPct);
  }

  @Post('trips/:tripId/cancel-suggestion/decision')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Accept or reject the suggestion to cancel this trip, with the reason' })
  decide(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(SuggestionDecisionSchema)) dto: SuggestionDecisionDto,
  ) {
    return this.demand.decideCancelSuggestion(tripId as TripId, dto.decision, dto.reason);
  }
}
