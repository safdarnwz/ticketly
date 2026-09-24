import { Body, Controller, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ApiStandardErrors, Public, zodBody } from '@http';
import { type CityId, type LocalDate } from '@kernel';

import { StorefrontService } from '../application/services/storefront.service';

const FilterSchema = z.object({
  minPriceMinor: z.number().int().min(0).optional(),
  maxPriceMinor: z.number().int().min(0).optional(),
  departAfter: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  departBefore: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  seatTypes: z.array(z.string()).optional(),
  amenities: z.array(z.string()).optional(),
  minRating: z.number().min(0).max(5).optional(),
  minSeats: z.number().int().min(1).optional(),
}).optional();

const SearchSchema = z.object({
  originCityId: z.string().uuid(),
  destCityId: z.string().uuid(),
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filter: FilterSchema,
  sort: z.enum(['price', 'departure', 'duration', 'rating']).default('departure'),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
const RoundTripSchema = z.object({
  originCityId: z.string().uuid(),
  destCityId: z.string().uuid(),
  onwardDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filter: FilterSchema,
  sort: z.enum(['price', 'departure', 'duration', 'rating']).default('departure'),
});
const ConnectingSchema = z.object({
  originCityId: z.string().uuid(),
  hubCityId: z.string().uuid(),
  destCityId: z.string().uuid(),
  journeyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minLayoverMin: z.number().int().min(0).max(1440).optional(),
  maxLayoverMin: z.number().int().min(0).max(1440).optional(),
});

@ApiTags('storefront')
@Controller({ path: 'storefront', version: '1' })
@ApiStandardErrors()
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Post('search')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Search direct trips with filters + sorting' })
  async search(@Body(zodBody(SearchSchema)) dto: z.infer<typeof SearchSchema>) {
    const results = await this.storefront.searchFiltered({
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      journeyDate: dto.journeyDate as LocalDate,
      filter: dto.filter,
      sort: dto.sort,
      sortDir: dto.sortDir,
    });
    return { results, count: results.length };
  }

  @Post('round-trip')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Search onward + return legs' })
  async roundTrip(@Body(zodBody(RoundTripSchema)) dto: z.infer<typeof RoundTripSchema>) {
    return this.storefront.roundTrip({
      originCityId: dto.originCityId as CityId,
      destCityId: dto.destCityId as CityId,
      onwardDate: dto.onwardDate as LocalDate,
      returnDate: dto.returnDate as LocalDate,
      filter: dto.filter,
      sort: dto.sort,
    });
  }

  @Post('connecting')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Find connecting journeys via a hub city' })
  async connecting(@Body(zodBody(ConnectingSchema)) dto: z.infer<typeof ConnectingSchema>) {
    const journeys = await this.storefront.searchConnecting({
      originCityId: dto.originCityId as CityId,
      hubCityId: dto.hubCityId as CityId,
      destCityId: dto.destCityId as CityId,
      journeyDate: dto.journeyDate as LocalDate,
      minLayoverMin: dto.minLayoverMin,
      maxLayoverMin: dto.maxLayoverMin,
    });
    return { journeys, count: journeys.length };
  }
}
