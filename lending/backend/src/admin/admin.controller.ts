import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { StaffPrincipal } from '../auth/auth.types';
import { CurrentUser, RequirePermissions, StaffAuthGuard } from '../auth/guards';
import { FIVE_PERSON_TEAM, Permission, ROLE_PERMISSIONS } from '../common/roles';
import { DisbursementService } from '../disbursement/disbursement.service';
import { CreateStaffDto, PlanDto, ReviewDto, StaffLoginDto, UpdatePlanDto } from '../instant-loan/dto';
import { InstantLoanService } from '../instant-loan/instant-loan.service';
import { toPlanInput, toPlanPatch } from '../pricing/plan.mapper';
import { PricingService } from '../pricing/pricing.service';
import { StaffService } from '../staff/staff.service';
import { MetricsService } from './metrics.service';

@Controller('staff')
export class StaffAuthController {
  constructor(private readonly staff: StaffService) {}
  @Post('login') @HttpCode(200)
  login(@Body() dto: StaffLoginDto) {
    return this.staff.login(dto.email, dto.password, dto.totp);
  }
}

@Controller('admin')
@UseGuards(StaffAuthGuard)
export class AdminController {
  constructor(
    private readonly staff: StaffService,
    private readonly pricing: PricingService,
    private readonly loans: InstantLoanService,
    private readonly disbursal: DisbursementService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditService,
  ) {}

  @Get('roles')
  roles() {
    return { roles: ROLE_PERMISSIONS, suggestedFivePersonTeam: FIVE_PERSON_TEAM };
  }

  @Get('staff') @RequirePermissions(Permission.STAFF_MANAGE)
  listStaff() {
    return this.staff.list();
  }

  @Post('staff') @RequirePermissions(Permission.STAFF_MANAGE)
  createStaff(@CurrentUser() u: StaffPrincipal, @Body() dto: CreateStaffDto) {
    return this.staff.create(dto, u.sub, u.roles);
  }

  // ---- Pricing plans & offers: OWNER only, fresh authenticator code on every change ----

  @Get('pricing-plans') @RequirePermissions(Permission.PRICING_VIEW)
  plans(@Query('scope') scope?: string, @Query('mobile') mobile?: string) {
    return this.pricing.list({ scope, mobile });
  }

  @Get('pricing-plans/preview') @RequirePermissions(Permission.PRICING_VIEW)
  preview(@Query('mobile') mobile: string, @Query('amount') amount: string) {
    if (!/^[6-9]\d{9}$/.test(mobile ?? '') || !(Number(amount) > 0)) throw new BadRequestException('mobile and amount are required');
    return this.pricing.preview(mobile, Math.round(Number(amount) * 100));
  }

  @Get('pricing-plans/:id') @RequirePermissions(Permission.PRICING_VIEW)
  plan(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.get(id);
  }

  @Post('pricing-plans') @RequirePermissions(Permission.PRICING_MANAGE)
  async createPlan(@CurrentUser() u: StaffPrincipal, @Headers('x-totp') code: string | undefined, @Body() dto: PlanDto) {
    await this.staff.verifyStepUp(u.sub, code);
    return this.pricing.create(toPlanInput(dto), u.sub);
  }

  @Patch('pricing-plans/:id') @RequirePermissions(Permission.PRICING_MANAGE)
  async updatePlan(@CurrentUser() u: StaffPrincipal, @Headers('x-totp') code: string | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    await this.staff.verifyStepUp(u.sub, code);
    return this.pricing.update(id, toPlanPatch(dto), u.sub);
  }

  @Get('applications/review-queue') @RequirePermissions(Permission.APPLICATION_REVIEW)
  queue() {
    return this.loans.listForReview();
  }

  @Get('applications/:id') @RequirePermissions(Permission.APPLICATION_VIEW)
  application(@Param('id', ParseUUIDPipe) id: string) {
    return this.loans.status(id, null);
  }

  @Post('applications/:id/review') @HttpCode(200) @RequirePermissions(Permission.APPLICATION_REVIEW)
  review(@CurrentUser() u: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.loans.review(id, u, dto);
  }

  @Get('disbursements') @RequirePermissions(Permission.DISBURSAL_VIEW)
  disbursements(@Query('hours') hours?: string) {
    return this.disbursal.listRecent(Number(hours ?? 24));
  }

  @Post('disbursements/poll') @HttpCode(200) @RequirePermissions(Permission.DISBURSAL_RETRY)
  poll() {
    return this.disbursal.pollPending().then((checked) => ({ checked }));
  }

  @Post('reconciliation/run') @HttpCode(200) @RequirePermissions(Permission.RECONCILE)
  reconcile() {
    return this.disbursal.reconcile();
  }

  @Get('metrics/instant-disbursal') @RequirePermissions(Permission.METRICS_VIEW)
  sla(@Query('from') from?: string, @Query('to') to?: string) {
    return this.metrics.instantDisbursal(from ? new Date(from) : new Date(Date.now() - 7 * 86_400_000), to ? new Date(to) : new Date());
  }

  @Get('audit') @RequirePermissions(Permission.AUDIT_VIEW)
  auditLog(@Query('entityType') t?: string, @Query('entityId') id?: string) {
    return this.audit.list(t, id);
  }
}
