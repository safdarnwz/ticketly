import { Body, Controller, Delete, Get, Header, Post, Put, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { UnitOfWork } from '@database';
import { ApiStandardErrors, Public, RateLimit, RequirePermission, UuidParam, zodBody } from '@http';
import { BadRequestError, getUserId, requireTenantId, type StopId, type TripId } from '@kernel';

import { CouponRepository } from '../infrastructure/persistence/coupon.repository';
import { FareBulkService } from '../application/services/fare-bulk.service';
import {
  AddFareRuleSchema,
  AdjustFaresSchema,
  ImportFareRulesSchema,
  type AdjustFaresDto,
  type ImportFareRulesDto,
  CreateCouponSchema,
  CreateFarePlanSchema,
  CreatePricingPolicySchema,
  QuoteSchema,
  RouteRulesSchema,
  SeatFareOverrideSchema,
  TripFareAdjustmentSchema,
  type AddFareRuleDto,
  type CreateCouponDto,
  type CreateFarePlanDto,
  type CreatePricingPolicyDto,
  type QuoteDto,
  type RouteRulesDto,
  type SeatFareOverrideDto,
  type TripFareAdjustmentDto,
} from './dto/pricing.dto';
import { FareRepository } from '../infrastructure/persistence/fare.repository';
import { PricingService } from '../application/services/pricing.service';
import { validateBounds, validatePeakWindows } from '../domain/pricing-rules';

@ApiTags('pricing')
@ApiBearerAuth('bearer')
@Controller({ path: 'pricing', version: '1' })
@ApiStandardErrors()
export class PricingController {
  constructor(
    private readonly fareBulk: FareBulkService,
    private readonly fares: FareRepository,
    private readonly coupons: CouponRepository,
    private readonly pricing: PricingService,
    private readonly uow: UnitOfWork,
  ) {}

  /* ── fare plans & rules ─────────────────────────────────────────────────*/

  @Get('fare-plans')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'List fare plans for this operator' })
  async listPlans() {
    return { plans: await this.fares.listPlans() };
  }

  @Get('fare-plans/:id/rules')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'List rules for a fare plan' })
  async listRules(@UuidParam('id') id: string) {
    return { rules: await this.fares.listRules(id) };
  }

  @Get('fare-plans/:id/rules.csv')
  @RequirePermission(Permission.FARE_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="fare-rules.csv"')
  @ApiOperation({ summary: "A plan's fares as CSV — edit in Excel and import back" })
  exportRules(@UuidParam('id') id: string) {
    return this.fareBulk.exportCsv(id);
  }

  @Post('fare-plans/:id/rules/import')
  @HttpCode(200)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary: 'Save a whole fare sheet at once (all rows checked first; nothing saved on an error)',
  })
  importRules(
    @UuidParam('id') id: string,
    @Body(zodBody(ImportFareRulesSchema)) dto: ImportFareRulesDto,
  ) {
    return this.fareBulk.importRules(id, dto.rows);
  }

  @Post('fare-plans/:id/rules/adjust')
  @HttpCode(200)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Raise or lower every fare of a plan by a percentage' })
  adjustRules(@UuidParam('id') id: string, @Body(zodBody(AdjustFaresSchema)) dto: AdjustFaresDto) {
    return this.fareBulk.adjust(id, dto);
  }

  @Post('fare-plans')
  @HttpCode(201)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Create a fare plan for a route' })
  async createPlan(@Body(zodBody(CreateFarePlanSchema)) dto: CreateFarePlanDto) {
    const id = await this.uow.run(
      { name: 'pricing.createPlan', tenantId: requireTenantId() },
      async () => this.fares.createPlan(dto as never),
    );
    return { id };
  }

  @Post('fare-plans/rules')
  @HttpCode(201)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Add or update a segment fare rule' })
  async addRule(@Body(zodBody(AddFareRuleSchema)) dto: AddFareRuleDto) {
    await this.uow.run({ name: 'pricing.addRule', tenantId: requireTenantId() }, async () =>
      this.fares.addRule({
        farePlanId: dto.farePlanId,
        fromStopId: dto.fromStopId as StopId | undefined,
        toStopId: dto.toStopId as StopId | undefined,
        seatType: dto.seatType,
        baseFareMinor: dto.baseFareMinor,
        perKmMinor: dto.perKmMinor,
      }),
    );
    return { ok: true };
  }

  @Post('fare-plans/:id/activate')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Activate a fare plan' })
  async activatePlan(@UuidParam('id') id: string) {
    await this.uow.run({ name: 'pricing.activatePlan', tenantId: requireTenantId() }, async () =>
      this.fares.activatePlan(id),
    );
    return { ok: true };
  }

  /* ── per-seat-number fare overrides ─────────────────────────────────────*/

  @Get('fare-plans/:id/seat-overrides')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'List per-seat-number fare overrides for a plan' })
  async listSeatOverrides(@UuidParam('id') id: string) {
    return { items: await this.fares.listSeatOverrides(id) };
  }

  @Post('fare-plans/:id/seat-overrides')
  @HttpCode(201)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary:
      "Set (or update) a specific seat number's fare on this plan — overrides the seat-type rule for that seat only",
  })
  async setSeatOverride(
    @UuidParam('id') id: string,
    @Body(zodBody(SeatFareOverrideSchema)) dto: SeatFareOverrideDto,
  ) {
    await this.fares.setSeatOverride(id, dto.seatNumber, dto.fareMinor);
    return { ok: true };
  }

  @Delete('fare-plans/seat-overrides/:overrideId')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary: 'Remove a seat-number fare override — that seat goes back to the seat-type rule',
  })
  async deleteSeatOverride(@UuidParam('overrideId') overrideId: string) {
    await this.fares.deleteSeatOverride(overrideId);
    return { ok: true };
  }

  /* ── dynamic-pricing policy & coupons ───────────────────────────────────*/

  @Get('policies')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'List dynamic-pricing policies' })
  async listPolicies() {
    return { policies: await this.fares.listPolicies() };
  }

  @Post('policies')
  @HttpCode(201)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Create a dynamic-pricing (yield) policy' })
  async createPolicy(@Body(zodBody(CreatePricingPolicySchema)) dto: CreatePricingPolicyDto) {
    const id = await this.uow.run(
      { name: 'pricing.createPolicy', tenantId: requireTenantId() },
      async () =>
        this.fares.createPolicy({ routeId: dto.routeId, name: dto.name, ladder: dto.ladder }),
    );
    return { id };
  }

  @Post('policies/:id/deactivate')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Switch a yield policy off — its routes fall back to plain fares' })
  async deactivatePolicy(@UuidParam('id') id: string) {
    await this.uow.run({ name: 'pricing.deactivatePolicy', tenantId: requireTenantId() }, () =>
      this.fares.deactivatePolicy(id),
    );
    return { ok: true };
  }

  @Get('coupons')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'List coupons' })
  async listCoupons() {
    return { coupons: await this.coupons.list() };
  }

  @Post('coupons')
  @HttpCode(201)
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Create a coupon' })
  async createCoupon(@Body(zodBody(CreateCouponSchema)) dto: CreateCouponDto) {
    const id = await this.uow.run(
      { name: 'pricing.createCoupon', tenantId: requireTenantId() },
      async () => this.coupons.create(dto as never),
    );
    return { id };
  }

  @Post('coupons/:id/disable')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary: 'Disable a coupon — stops working immediately, existing redemptions untouched',
  })
  async disableCoupon(@UuidParam('id') id: string) {
    await this.coupons.setActive(id, false);
    return { ok: true };
  }

  @Post('coupons/:id/enable')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Re-enable a disabled coupon' })
  async enableCoupon(@UuidParam('id') id: string) {
    await this.coupons.setActive(id, true);
    return { ok: true };
  }

  @Get('coupons/:id/stats')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'Redemption count + estimated total discount given for a coupon' })
  async couponStats(@UuidParam('id') id: string) {
    return this.coupons.stats(id);
  }

  /* ── quote (public-ish, rate-limited) ───────────────────────────────────*/

  @Post('quote')
  @HttpCode(200)
  @Public()
  @RateLimit(120, 60_000, 'ip')
  @ApiOperation({ summary: 'Get a firm, short-lived price quote for a segment' })
  async quote(@Body(zodBody(QuoteSchema)) dto: QuoteDto) {
    return this.pricing.quote({
      tripId: dto.tripId as TripId,
      fromStopId: dto.fromStopId as StopId,
      toStopId: dto.toStopId as StopId,
      seatType: dto.seatType,
      seatNumbers: dto.seatNumbers,
      seatCount: dto.seatCount,
      couponCode: dto.couponCode,
    });
  }

  @Put('routes/:routeId/rules')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary:
      'Route fare floor / ceiling (per seat, before GST) and peak / off-peak windows by departure time',
  })
  async routeRules(
    @UuidParam('routeId') routeId: string,
    @Body(zodBody(RouteRulesSchema)) dto: RouteRulesDto,
  ) {
    const problem =
      validateBounds(dto.floorMinor, dto.ceilingMinor) ?? validatePeakWindows(dto.peakWindows);
    if (problem) throw new BadRequestError(problem);
    await this.fares.saveRouteRules(routeId, dto, getUserId() ?? null);
    return { ok: true };
  }

  @Put('trips/:tripId/adjustment')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary:
      'Manual fare change for ONE trip: −50…+100 % with a reason (null clears). Applies to new quotes only.',
  })
  async tripAdjustment(
    @UuidParam('tripId') tripId: string,
    @Body(zodBody(TripFareAdjustmentSchema)) dto: TripFareAdjustmentDto,
  ) {
    await this.fares.setTripAdjustment(
      tripId,
      dto.pct,
      dto.pct === null ? null : (dto.reason ?? null),
      getUserId() ?? null,
    );
    return { ok: true };
  }
}
