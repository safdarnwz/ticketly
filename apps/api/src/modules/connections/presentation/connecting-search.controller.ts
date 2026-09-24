import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, Public } from '@http';
import { localDate } from '@kernel';

import { ConnectingSearchService } from '../application/services/connecting-search.service';

@ApiTags('connections')
@Controller({ path: 'search/connecting', version: '1' })
@ApiStandardErrors()
export class ConnectingSearchController {
  constructor(private readonly search: ConnectingSearchService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Two-leg connecting journeys across operators when no direct route exists (e.g. Delhi -> Kolkata -> Bhubaneswar) — layover between legs is always 2-24 hours' })
  async find(@Query('originCityId') originCityId: string, @Query('destinationCityId') destinationCityId: string, @Query('date') date: string) {
    const options = await this.search.search(originCityId, destinationCityId, localDate(date));
    return { options };
  }
}
