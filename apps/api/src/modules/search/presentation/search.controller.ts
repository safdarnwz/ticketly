import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, Public, RateLimit, UuidParam, zodBody, zodQuery } from '@http';
import { localDate, type CityId, type StopId } from '@kernel';

import { BusDetailsService } from '../application/services/bus-details.service';
import { JourneySearchService } from '../application/services/journey-search.service';
import {
  ConnectingSearchSchema,
  RoundTripSchema,
  SearchTripsSchema,
  TripDetailsQuerySchema,
  type TripDetailsQueryDto,
  type ConnectingSearchDto,
  type RoundTripDto,
  type SearchTripsDto,
} from './dto/search.dto';

/**
 * Trip search — the storefront's most-hit endpoints.
 *
 * `@Public()` (a customer searches before logging in) and rate-limited per IP
 * to blunt scraping. On www.ticketly.com no operator is bound, so results
 * aggregate across every operator; on an operator's own console/host they are
 * scoped to that operator (see SearchService).
 */
@ApiTags('search')
@Controller({ path: 'search', version: '1' })
@ApiStandardErrors()
export class SearchController {
  constructor(
    private readonly journeys: JourneySearchService,
    private readonly details: BusDetailsService,
  ) {}

  @Get('trips/:tripId/details')
  @Public()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({
    summary:
      "Everything under the seat map for this trip's bus: highlights, cancellation with dates, route, boarding / dropping points, features, the bus's own reviews, safety, photos, other policies",
  })
  async tripDetails(
    @UuidParam('tripId') tripId: string,
    @Query(zodQuery(TripDetailsQuerySchema)) q: TripDetailsQueryDto,
  ) {
    return this.details.forTrip(tripId, q.from, q.to);
  }

  @Post()
  @Public()
  @HttpCode(200)
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({
    summary: 'Direct trips for a city pair and date — optional stops, filters and sort',
  })
  async trips(@Body(zodBody(SearchTripsSchema)) dto: SearchTripsDto) {
    const results = await this.journeys.trips({
      ...dto,
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      journeyDate: localDate(dto.journeyDate),
      fromStopId: dto.fromStopId as StopId | undefined,
      toStopId: dto.toStopId as StopId | undefined,
    });
    return { count: results.length, results };
  }

  @Post('round-trip')
  @Public()
  @HttpCode(200)
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({ summary: 'Onward and return trips in one call' })
  async roundTrip(@Body(zodBody(RoundTripSchema)) dto: RoundTripDto) {
    return this.journeys.roundTrip({
      ...dto,
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      onwardDate: localDate(dto.onwardDate),
      returnDate: localDate(dto.returnDate),
    });
  }

  @Post('connecting')
  @Public()
  @HttpCode(200)
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Two-leg journeys via a hub city when there is no direct bus (hubs discovered across operators; overnight connections included). Book with POST /connections/hold.',
  })
  async connecting(@Body(zodBody(ConnectingSearchSchema)) dto: ConnectingSearchDto) {
    const journeys = await this.journeys.connecting({
      ...dto,
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      hubCityId: dto.hubCityId as CityId | undefined,
      journeyDate: localDate(dto.journeyDate),
    });
    return { count: journeys.length, journeys };
  }
}
