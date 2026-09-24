import { Body, Controller, Delete, Get, Param, Post, Put, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { UnitOfWork } from '@database';
import { ApiStandardErrors, Public, RateLimit, RequirePermission, zodBody } from '@http';
import { BadRequestError, getUserId, requireTenantId, type StopId, type TripId } from '@kernel';

import { CouponRepository } from '../infrastructure/persistence/coupon.repository';
import {
  AddFareRuleSchema,
  type AddFareRuleDto,
  CreateCouponSchema,
  type CreateCouponDto,
  CreateFarePlanSchema,
  type CreateFarePlanDto,
  CreatePricingPolicySchema,
  type CreatePricingPolicyDto,
  QuoteSchema,
  type QuoteDto,
} from './dto/pricing.dto';
import { FareRepository } from '../infrastructure/persistence/fare.repository';
import { PricingService } from '../application/services/pricing.service';
import { validateBounds, validatePeakWindows } from '../domain/pricing-rules';

const RouteRulesSchema = z.object({
  floorMinor: z.number().int().nonnegative().nullable(),
  ceilingMinor: z.number().int().positive().nullable(),
  peakWindows: z
    .array(
      z.object({
        startMinute: z.number().int().min(0).max(1439),
        endMinute: z.number().int().min(0).max(1439),
        pct: z.number().min(-50).max(100),
        label: z.string().max(40).optional(),
      }),
    )
    .max(12),
});
const TripAdjSchema = z
  .object({
    pct: z
      .number()
      .min(-50)
      .max(100)
      .refine((n) => n !== 0, 'Use null to clear')
      .nullable(),
    reason: z.string().trim().min(5).max(200).optional(),
  })
  .refine((d) => d.pct === null || !!d.reason, {
    message: 'A reason is required for a fare change',
  });

@ApiTags('pricing')
@ApiBearerAuth('bearer')
@Controller({ path: 'pricing', version: '1' })
@ApiStandardErrors()
export class PricingController {
  constructor(
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
  async listRules(@Param('id') id: string) {
    return { rules: await this.fares.listRules(id) };
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
  async activatePlan(@Param('id') id: string) {
    await this.uow.run({ name: 'pricing.activatePlan', tenantId: requireTenantId() }, async () =>
      this.fares.activatePlan(id),
    );
    return { ok: true };
  }

  /* ── per-seat-number fare overrides ─────────────────────────────────────*/

  @Get('fare-plans/:id/seat-overrides')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'List per-seat-number fare overrides for a plan' })
  async listSeatOverrides(@Param('id') id: string) {
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
    @Param('id') id: string,
    @Body() dto: { seatNumber: string; fareMinor: number },
  ) {
    await this.fares.setSeatOverride(id, dto.seatNumber, dto.fareMinor);
    return { ok: true };
  }

  @Delete('fare-plans/seat-overrides/:overrideId')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({
    summary: 'Remove a seat-number fare override — that seat goes back to the seat-type rule',
  })
  async deleteSeatOverride(@Param('overrideId') overrideId: string) {
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
  async disableCoupon(@Param('id') id: string) {
    await this.coupons.setActive(id, false);
    return { ok: true };
  }

  @Post('coupons/:id/enable')
  @RequirePermission(Permission.FARE_MANAGE)
  @ApiOperation({ summary: 'Re-enable a disabled coupon' })
  async enableCoupon(@Param('id') id: string) {
    await this.coupons.setActive(id, true);
    return { ok: true };
  }

  @Get('coupons/:id/stats')
  @RequirePermission(Permission.FARE_READ)
  @ApiOperation({ summary: 'Redemption count + estimated total discount given for a coupon' })
  async couponStats(@Param('id') id: string) {
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
    @Param('routeId') routeId: string,
    @Body(zodBody(RouteRulesSchema)) dto: z.infer<typeof RouteRulesSchema>,
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
    @Param('tripId') tripId: string,
    @Body(zodBody(TripAdjSchema)) dto: z.infer<typeof TripAdjSchema>,
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
