import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, Public, RateLimit, zodBody } from '@http';
import { localDate, type CityId, type StopId } from '@kernel';

import { SearchSchema, type SearchDto } from '../../pricing/presentation/dto/pricing.dto';
import { SearchService } from '../application/services/search.service';

/**
 * Trip search — the public storefront's most-hit endpoint.
 *
 * `@Public()` (a customer searches before logging in) but rate-limited per IP
 * to blunt scraping. The tenant is resolved from the storefront host
 * (subdomain / custom domain) by the resolution middleware, so a search is
 * always scoped to one operator even without auth.
 */
@ApiTags('search')
@Controller({ path: 'search', version: '1' })
@ApiStandardErrors()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({ summary: 'Search trips by origin/destination city and date' })
  async searchTrips(@Body(zodBody(SearchSchema)) dto: SearchDto) {
    const results = await this.search.search({
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      journeyDate: localDate(dto.journeyDate),
      seatType: dto.seatType,
      fromStopId: dto.fromStopId as StopId | undefined,
      toStopId: dto.toStopId as StopId | undefined,
    });
    return { count: results.length, results };
  }
}
