import { Body, Controller, Get, Post, Put, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  Public,
  RateLimit,
  RequirePermission,
  SegmentQuerySchema,
  UuidParam,
  zodBody,
  zodQuery,
  type SegmentQuery,
} from '@http';
import {
  BadRequestError,
  getUserId,
  localDate,
  type ServiceId,
  type StopId,
  type TripId,
} from '@kernel';

import {
  BlockSeatsSchema,
  SalesRulesSchema,
  CreateServiceSchema,
  ExtraTripsSchema,
  PreviewDatesSchema,
  ReleaseHoldsSchema,
  TripRemarkSchema,
  TripListQuerySchema,
  type TripListQuery,
  type BlockSeatsDto,
  type SalesRulesDto,
  type CreateServiceDto,
  type ExtraTripsDto,
  type PreviewDatesDto,
  type ReleaseHoldsDto,
  type TripRemarkDto,
} from './dto/scheduling.dto';
import { InventoryRepository } from '../infrastructure/persistence/inventory.repository';
import { MaterializationService } from '../application/services/materialization.service';
import { SchedulingService } from '../application/services/scheduling.service';
import { ServiceRepository } from '../infrastructure/persistence/service.repository';
import { TripRepository } from '../infrastructure/persistence/trip.repository';

@ApiTags('scheduling')
@ApiBearerAuth('bearer')
@Controller({ path: 'scheduling', version: '1' })
@ApiStandardErrors()
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly materialization: MaterializationService,
    private readonly trips: TripRepository,
    private readonly inventory: InventoryRepository,
    private readonly services: ServiceRepository,
  ) {}

  @Get('services')
  @RequirePermission(Permission.SERVICE_READ)
  @ApiOperation({ summary: 'List every service (any status) for this operator' })
  async listServices() {
    return { services: await this.services.listAll() };
  }

  @Post('services')
  @HttpCode(201)
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Create a recurring service' })
  async createService(@Body(zodBody(CreateServiceSchema)) dto: CreateServiceDto) {
    return { id: await this.scheduling.createService(dto as never) };
  }

  @Post('services/:id/activate')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Activate a service and materialise its trips' })
  async activate(@UuidParam('id') id: string) {
    return this.scheduling.activate(id as ServiceId);
  }

  @Post('services/:id/pause')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Pause a service (stops new materialisation)' })
  async pause(@UuidParam('id') id: string) {
    await this.scheduling.pause(id as ServiceId);
    return { ok: true };
  }

  @Get('services/:id/sales-rules')
  @RequirePermission(Permission.SERVICE_READ)
  async salesRules(@UuidParam('id') id: string) {
    return this.services.salesRules(id as ServiceId);
  }

  @Put('services/:id/sales-rules')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'OTA release % (share of each trip partners may sell) and seats kept for women / senior citizens until a release time',
  })
  setSalesRules(@UuidParam('id') id: string, @Body(zodBody(SalesRulesSchema)) dto: SalesRulesDto) {
    return this.scheduling.setSalesRules(id as ServiceId, dto);
  }

  @Post('services/:id/materialise')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({ summary: 'Force-materialise the horizon for a service' })
  async materialise(@UuidParam('id') id: string) {
    return { trips: await this.materialization.materialiseService(id as ServiceId) };
  }

  @Post('services/preview-dates')
  @HttpCode(200)
  @RequirePermission(Permission.SERVICE_READ)
  @ApiOperation({ summary: 'Preview which dates a recurrence rule would run on' })
  previewDates(@Body(zodBody(PreviewDatesSchema)) dto: PreviewDatesDto) {
    return { dates: this.scheduling.previewDates(dto.recurrence as never, dto.from, dto.to) };
  }

  @Get('trips/:id')
  @Public()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({ summary: 'Trip detail with its stop timetable' })
  async getTrip(@UuidParam('id') id: string) {
    return this.scheduling.tripDetail(id as TripId);
  }

  @Get('trips')
  @RequirePermission(Permission.SERVICE_READ)
  @ApiOperation({
    summary:
      'Trips across every service: one journey date (`date`, any status) or everything still to leave — occupancy counts paid seats; seats being paid for right now are `heldSeats`',
  })
  async listTrips(@Query(zodQuery(TripListQuerySchema)) q: TripListQuery) {
    return { items: await this.trips.listUpcoming(q.limit, q.date) };
  }

  @Get('trips/:id/availability')
  @Public()
  @RateLimit(120, 60_000, 'ip')
  @ApiQuery({ name: 'from', required: true, description: 'origin stop id' })
  @ApiQuery({ name: 'to', required: true, description: 'destination stop id' })
  @ApiOperation({
    summary: 'Seat map for a segment: bus layout, each seat placed on it, and whether it is free',
  })
  async availability(
    @UuidParam('id') id: string,
    @Query(zodQuery(SegmentQuerySchema)) q: SegmentQuery,
  ) {
    return this.scheduling.seatMap(id as TripId, q.from as StopId, q.to as StopId);
  }

  @Post('trips/:id/block-seats')
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Block or unblock seats on a segment (quota/hold)' })
  async blockSeats(
    @UuidParam('id') id: string,
    @Body(zodBody(BlockSeatsSchema)) dto: BlockSeatsDto,
  ) {
    const seg = await this.inventory.resolveSegment(
      id as TripId,
      dto.fromStopId as StopId,
      dto.toStopId as StopId,
    );
    if (!seg) throw new BadRequestError('Invalid segment for this trip');
    const affected = await this.inventory.blockSeats(
      id as TripId,
      dto.seatNumbers,
      seg.fromSeq,
      seg.toSeq,
      dto.block,
    );
    return { affected };
  }

  /* ── extra / special trips ─────────────────────────────────────────────*/

  @Post('services/:id/extra-trips')
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Add one-off EXTRA trips of a service (festival / event / ladies special) for 1–31 dates. Created closed to sale unless openForSale.',
  })
  async extraTrips(
    @UuidParam('id') id: string,
    @Body(zodBody(ExtraTripsSchema)) dto: ExtraTripsDto,
  ) {
    const [h, m] = (dto.departureTime ?? '').split(':').map(Number);
    return this.materialization.createExtraTrips({
      serviceId: id as ServiceId,
      journeyDates: dto.journeyDates.map((d) => localDate(d)),
      departureMinute: dto.departureTime ? h * 60 + m : undefined,
      vehicleId: (dto.vehicleId ?? null) as never,
      reason: dto.reason,
      openForSale: dto.openForSale ?? false,
      ladiesSpecial: dto.ladiesSpecial ?? false,
      allowOverlap: dto.allowOverlap ?? false,
    });
  }

  @Post('trips/:id/release-inventory')
  @HttpCode(200)
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({ summary: 'Open a trip (e.g. a new extra trip) for sale on every channel' })
  async releaseInventory(@UuidParam('id') id: string) {
    if (!(await this.trips.openAllChannels(id as TripId)))
      throw new BadRequestError('Only a scheduled/open trip can be released for sale');
    return { ok: true };
  }

  @Get('extra-trip-suggestions')
  @RequirePermission(Permission.SERVICE_MANAGE)
  @ApiOperation({
    summary:
      'Trips in the next 7 days that are ≥ 80% sold or have people on the waitlist — candidates for an extra trip',
  })
  async suggestions() {
    return { items: await this.trips.extraTripCandidates() };
  }

  @Post('trips/:id/release-holds')
  @HttpCode(200)
  @RequirePermission(Permission.INVENTORY_MANAGE)
  @ApiOperation({
    summary:
      'Force-release all live checkout holds on a trip (phone holds kept unless includePhoneHolds)',
  })
  async releaseHolds(
    @UuidParam('id') id: string,
    @Body(zodBody(ReleaseHoldsSchema)) dto: ReleaseHoldsDto,
  ) {
    await this.trips.getById(id as TripId);
    return { released: await this.trips.releaseHolds(id as TripId, dto.includePhoneHolds) };
  }

  @Post('trips/:id/remarks')
  @HttpCode(201)
  @RequirePermission(Permission.TRIP_OPERATE)
  @ApiOperation({ summary: 'Add an internal (staff-only) remark to a trip' })
  async addRemark(
    @UuidParam('id') id: string,
    @Body(zodBody(TripRemarkSchema)) dto: TripRemarkDto,
  ) {
    await this.trips.getById(id as TripId);
    await this.trips.addRemark(id as TripId, dto.remark, getUserId() ?? null);
    return { ok: true };
  }

  @Get('trips/:id/remarks')
  @RequirePermission(Permission.TRIP_OPERATE)
  async listRemarks(@UuidParam('id') id: string) {
    return { items: await this.trips.remarks(id as TripId) };
  }
}
