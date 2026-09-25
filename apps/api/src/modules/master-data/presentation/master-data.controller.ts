import { Body, Controller, Delete, Get, Param, Patch, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

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
import { NotFoundError, type CityId, type RouteId, type SeatLayoutId, type StopId } from '@kernel';

import {
  BulkImportStopsSchema,
  CitySearchQuerySchema,
  CreateAmenitySchema,
  CreateRouteSchema,
  CreateSeatLayoutSchema,
  MarkSeatsSchema,
  type MarkSeatsDto,
  CreateStopSchema,
  CreateVehicleTypeSchema,
  DuplicateRouteSchema,
  ListRoutesQuerySchema,
  SeatMapSchema,
  UpdateStopSchema,
  type BulkImportStopsDto,
  type CitySearchQueryDto,
  type CreateAmenityDto,
  type CreateRouteDto,
  type CreateSeatLayoutDto,
  type CreateStopDto,
  type CreateVehicleTypeDto,
  type DuplicateRouteDto,
  type ListRoutesQueryDto,
  type UpdateStopDto,
} from './dto/master-data.dto';
import { AmenityRepository } from '../infrastructure/persistence/amenity.repository';
import { VehicleTypeRepository } from '../infrastructure/persistence/vehicle-type.repository';
import { GeographyRepository } from '../infrastructure/persistence/geography.repository';
import { StopRepository } from '../infrastructure/persistence/stop.repository';
import { RouteRepository } from '../infrastructure/persistence/route.repository';
import { RouteService } from '../application/services/route.service';
import { SeatLayoutRepository } from '../infrastructure/persistence/seat-layout.repository';
import { SeatLayoutService } from '../application/services/seat-layout.service';

/**
 * Master-data management surface for operator staff. Read endpoints that a
 * public storefront needs (city autocomplete) are `@Public()`; everything that
 * mutates catalogue data requires the matching manage permission.
 */
@ApiTags('master-data')
@ApiBearerAuth('bearer')
@Controller({ path: 'master-data', version: '1' })
@ApiStandardErrors()
export class MasterDataController {
  constructor(
    private readonly geography: GeographyRepository,
    private readonly stops: StopRepository,
    private readonly layouts: SeatLayoutRepository,
    private readonly layoutService: SeatLayoutService,
    private readonly vehicleTypes: VehicleTypeRepository,
    private readonly amenities: AmenityRepository,
    private readonly routes: RouteRepository,
    private readonly routeService: RouteService,
  ) {}

  /* ── geography ──────────────────────────────────────────────────────────*/

  @Public()
  @Get('cities/search')
  @RateLimit(60, 60_000, 'ip')
  @ApiQuery({ name: 'q', required: true })
  @ApiOperation({ summary: 'Fuzzy city autocomplete (public)' })
  async searchCities(@Query(zodQuery(CitySearchQuerySchema)) { q }: CitySearchQueryDto) {
    return { items: await this.geography.searchCities(q) };
  }

  @Public()
  @Get('cities/by-slug/:slug')
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({
    summary:
      'Resolve a URL-safe city slug (e.g. "new-delhi") back to the real city — lets search-result URLs use readable city names instead of raw UUIDs',
  })
  async cityBySlug(@Param('slug') slug: string) {
    const city = await this.geography.findBySlug(slug);
    if (!city) throw new NotFoundError('City', slug);
    return city;
  }

  @Get('cities/:cityId/stops')
  @Public()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({ summary: "List this operator's stops in a city (public)" })
  async stopsInCity(@UuidParam('cityId') cityId: string) {
    return { items: await this.stops.listByCity(cityId as CityId) };
  }

  @Post('stops')
  @HttpCode(201)
  @RequirePermission(Permission.STOP_MANAGE)
  @ApiOperation({ summary: 'Create a boarding / dropping point' })
  async createStop(@Body(zodBody(CreateStopSchema)) dto: CreateStopDto) {
    return { id: await this.stops.create({ ...dto, cityId: dto.cityId as CityId }) };
  }

  @Get('stops')
  @RequirePermission(Permission.STOP_MANAGE)
  @ApiOperation({ summary: 'Staff-management list of every stop (active + inactive)' })
  async listAllStops() {
    return { items: await this.stops.listAll() };
  }

  @Patch('stops/:id')
  @RequirePermission(Permission.STOP_MANAGE)
  @ApiOperation({ summary: 'Edit a stop' })
  async updateStop(
    @UuidParam('id') id: string,
    @Body(zodBody(UpdateStopSchema)) dto: UpdateStopDto,
  ) {
    await this.stops.update(id as StopId, dto);
    return { ok: true };
  }

  @Post('stops/:id/activate')
  @RequirePermission(Permission.STOP_MANAGE)
  @ApiOperation({ summary: 'Reactivate a stop' })
  async activateStop(@UuidParam('id') id: string) {
    await this.stops.setActive(id as StopId, true);
    return { ok: true };
  }

  @Post('stops/:id/deactivate')
  @RequirePermission(Permission.STOP_MANAGE)
  @ApiOperation({
    summary: 'Deactivate a stop — hides it from customer search without deleting route history',
  })
  async deactivateStop(@UuidParam('id') id: string) {
    await this.stops.setActive(id as StopId, false);
    return { ok: true };
  }

  @Post('stops/bulk-import')
  @RequirePermission(Permission.STOP_MANAGE)
  @ApiOperation({
    summary:
      'Bulk-import stops — each row validated independently, a bad row is skipped and reported rather than aborting the whole batch',
  })
  async bulkImportStops(@Body(zodBody(BulkImportStopsSchema)) dto: BulkImportStopsDto) {
    return this.stops.bulkImport(dto.rows as never);
  }

  /* ── seat layouts ───────────────────────────────────────────────────────*/

  @Post('seat-layouts/validate')
  @HttpCode(200)
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({ summary: 'Validate a seat layout without saving (designer preview)' })
  validateLayout(@Body(zodBody(SeatMapSchema)) layout: unknown) {
    return { summary: this.layoutService.validate(layout as never) };
  }

  @Post('seat-layouts')
  @HttpCode(201)
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({ summary: 'Create a validated seat layout' })
  async createLayout(@Body(zodBody(CreateSeatLayoutSchema)) dto: CreateSeatLayoutDto) {
    return this.layoutService.create(dto.name, dto.layout);
  }

  @Patch('seat-layouts/:id')
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({ summary: 'Edit an existing seat layout in place' })
  async updateLayout(
    @UuidParam('id') id: string,
    @Body(zodBody(CreateSeatLayoutSchema)) dto: CreateSeatLayoutDto,
  ) {
    return this.layoutService.update(id as SeatLayoutId, dto.name, dto.layout);
  }

  @Post('seat-layouts/:id/seats/mark')
  @HttpCode(200)
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({
    summary:
      'Mark seats window / aisle, ladies-only or disability-friendly (saved as a new version)',
  })
  markSeats(@UuidParam('id') id: string, @Body(zodBody(MarkSeatsSchema)) dto: MarkSeatsDto) {
    const { seatNumbers, ...patch } = dto;
    return this.layoutService.markSeats(id as SeatLayoutId, seatNumbers, patch);
  }

  @Post('seat-layouts/:id/seats/auto-positions')
  @HttpCode(200)
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({
    summary: 'Mark every window and aisle seat from the grid (saved as a new version)',
  })
  autoPositions(@UuidParam('id') id: string) {
    return this.layoutService.autoPositions(id as SeatLayoutId);
  }

  @Get('seat-layouts/:id/versions')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'Version history for a seat layout — every past save, restorable' })
  async listLayoutVersions(@UuidParam('id') id: string) {
    return { items: await this.layoutService.listVersions(id as SeatLayoutId) };
  }

  @Post('seat-layouts/:id/versions/:versionNumber/restore')
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({
    summary: 'Roll back to an earlier version — recorded as a new version, never rewrites history',
  })
  async restoreLayoutVersion(
    @UuidParam('id') id: string,
    @Param('versionNumber') versionNumber: string,
  ) {
    return this.layoutService.restoreVersion(id as SeatLayoutId, Number(versionNumber));
  }

  @Get('seat-layouts')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'List seat layouts' })
  async listLayouts() {
    return { items: await this.layouts.list() };
  }

  @Get('seat-layouts/:id')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'Get a seat layout (full map)' })
  async getLayout(@UuidParam('id') id: string) {
    const layout = await this.layouts.getById(id as SeatLayoutId);
    return { id: layout.id, name: layout.name, seatMap: layout.seatMap.toJSON() };
  }

  @Get('seat-layouts/:id/usage')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'How many vehicles currently use this layout (check before deleting)' })
  async layoutUsage(@UuidParam('id') id: string) {
    return { vehicleCount: await this.layouts.usageCount(id as SeatLayoutId) };
  }

  @Delete('seat-layouts/:id')
  @RequirePermission(Permission.LAYOUT_MANAGE)
  @ApiOperation({ summary: 'Delete a seat layout (refuses if any vehicle still uses it)' })
  async deleteLayout(@UuidParam('id') id: string) {
    await this.layouts.delete(id as SeatLayoutId);
    return { ok: true };
  }

  /* ── vehicle types & amenities ──────────────────────────────────────────*/

  @Post('vehicle-types')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Create a vehicle type / bus class' })
  async createVehicleType(@Body(zodBody(CreateVehicleTypeSchema)) dto: CreateVehicleTypeDto) {
    return { id: await this.vehicleTypes.create(dto as never) };
  }

  @Get('vehicle-types')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({ summary: 'List vehicle types' })
  async listVehicleTypes() {
    return { items: await this.vehicleTypes.list() };
  }

  @Post('amenities')
  @HttpCode(201)
  @RequirePermission(Permission.VEHICLE_MANAGE)
  @ApiOperation({ summary: 'Create an amenity' })
  async createAmenity(@Body(zodBody(CreateAmenitySchema)) dto: CreateAmenityDto) {
    return { id: await this.amenities.create(dto) };
  }

  @Get('amenities')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({ summary: 'List amenities' })
  async listAmenities() {
    return { items: await this.amenities.list() };
  }

  /* ── routes ─────────────────────────────────────────────────────────────*/

  @Post('routes')
  @HttpCode(201)
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({ summary: 'Create a route (validates the full path & segments)' })
  async createRoute(@Body(zodBody(CreateRouteSchema)) dto: CreateRouteDto) {
    return { id: await this.routeService.create(dto as never) };
  }

  @Get('routes')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'List routes' })
  async listRoutes(@Query(zodQuery(ListRoutesQuerySchema)) q: ListRoutesQueryDto) {
    return { items: await this.routes.list(q.status) };
  }

  @Get('routes/:id')
  @RequirePermission(Permission.ROUTE_READ)
  @ApiOperation({ summary: 'Get a route with its computed timetable & segments' })
  async getRoute(@UuidParam('id') id: string) {
    const route = await this.routes.getById(id as RouteId);
    return {
      id: route.id,
      code: route.code,
      name: route.name,
      status: route.status,
      totalDistanceKm: Math.round(route.path.totalDistanceM / 100) / 10,
      totalDurationMin: route.path.totalDurationMin,
      timetable: route.path.timetable(),
      segments: route.path.segments(),
    };
  }

  @Post('routes/:id/publish')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({ summary: 'Publish a route (makes it schedulable)' })
  async publishRoute(@UuidParam('id') id: string) {
    await this.routeService.publish(id as RouteId);
    return { ok: true };
  }

  @Post('routes/:id/duplicate')
  @HttpCode(201)
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({ summary: 'Duplicate a route — same stops/timing, fresh code, starts as draft' })
  async duplicateRoute(
    @UuidParam('id') id: string,
    @Body(zodBody(DuplicateRouteSchema)) dto: DuplicateRouteDto,
  ) {
    return { id: await this.routeService.duplicate(id as RouteId, dto.code, dto.name) };
  }

  @Post('routes/:id/archive')
  @RequirePermission(Permission.ROUTE_MANAGE)
  @ApiOperation({ summary: 'Archive a route' })
  async archiveRoute(@UuidParam('id') id: string) {
    await this.routeService.archive(id as RouteId);
    return { ok: true };
  }
}
