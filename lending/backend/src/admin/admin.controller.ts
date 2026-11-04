import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { StaffPrincipal } from '../auth/auth.types';
import { CurrentUser, RequirePermissions, StaffAuthGuard } from '../auth/guards';
import { FIVE_PERSON_TEAM, Permission, ROLE_PERMISSIONS } from '../common/roles';
import { DisbursementService } from '../disbursement/disbursement.service';
import { ActivatePolicyDto, CreateStaffDto, PolicyDraftDto, ReviewDto, StaffLoginDto } from '../instant-loan/dto';
import { InstantLoanService } from '../instant-loan/instant-loan.service';
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
    return this.staff.create(dto, u.sub);
  }

  @Get('pricing-policies') @RequirePermissions(Permission.PRICING_VIEW)
  policies() {
    return this.pricing.list();
  }

  @Post('pricing-policies') @RequirePermissions(Permission.PRICING_DRAFT)
  draft(@CurrentUser() u: StaffPrincipal, @Body() dto: PolicyDraftDto) {
    return this.pricing.draft(dto, u.sub);
  }

  @Post('pricing-policies/:id/activate') @HttpCode(200) @RequirePermissions(Permission.PRICING_ACTIVATE)
  activate(@CurrentUser() u: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActivatePolicyDto) {
    return this.pricing.activate(id, dto.boardApprovalRef, u.sub);
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
