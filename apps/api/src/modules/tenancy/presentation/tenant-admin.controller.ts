import { Body, Controller, Get, Param, Post, Put, Query, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { AppConfig } from '@config';
import { Permission } from '@contracts';
import { ApiStandardErrors, Idempotent, RequirePermission, zodBody } from '@http';
import { BadRequestError, ForbiddenError, getContext, type TenantId } from '@kernel';

import { AuditService } from '../../iam/application/services/audit.service';
import { BookingRepository } from '../../booking/infrastructure/persistence/booking.repository';
import { PayoutRepository } from '../infrastructure/persistence/payout.repository';
import {
  ProvisionTenantSchema,
  type ProvisionTenantDto,
  SuspendTenantSchema,
  type SuspendTenantDto,
} from './dto/tenant.dto';
import { PlanRepository } from '../infrastructure/persistence/plan.repository';
import { TenantContextService } from '../application/services/tenant-context.service';
import { PlatformSettingsRepository } from '../infrastructure/persistence/platform-settings.repository';
import { TenantProvisioningService } from '../application/services/tenant-provisioning.service';
import { TenantRepository } from '../infrastructure/persistence/tenant.repository';

const PlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/),
  name: z.string().trim().min(2).max(80),
  monthlyPrice: z.number().int().nonnegative(),
  currency: z.string().length(3).default('INR'),
  features: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/), z.boolean()).default({}),
  quotas: z
    .record(
      z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/),
      z.number().int().nonnegative().nullable(),
    )
    .default({}),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

/**
 * Platform-admin surface for managing operators.
 *
 * These endpoints operate ACROSS tenants and are gated by the platform
 * super-admin permission (`*`). A tenant's own staff never reach them — they
 * manage their operator through the tenant-scoped endpoints. Provisioning is
 * idempotent so a retried "create operator" cannot create two.
 */
@ApiTags('platform-admin')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/tenants', version: '1' })
@ApiStandardErrors()
export class TenantAdminController {
  constructor(
    private readonly provisioning: TenantProvisioningService,
    private readonly tenants: TenantRepository,
    private readonly plans: PlanRepository,
    private readonly bookings: BookingRepository,
    private readonly audit: AuditService,
    private readonly platformSettings: PlatformSettingsRepository,
    private readonly payouts: PayoutRepository,
    private readonly config: AppConfig,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'List every operator on the platform' })
  async list() {
    this.assertPlatformAdmin();
    const rows = await this.tenants.list();
    const baseDomain = new URL(this.config.app.publicBaseUrl).hostname;
    return {
      items: rows.map((t) => ({ ...t, consoleUrl: `https://app.${t.slug}.${baseDomain}` })),
    };
  }

  @Get(':id/stats')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      "One operator's booking numbers — total/today bookings, total/today cancellations, revenue",
  })
  async stats(@Param('id') id: string) {
    this.assertPlatformAdmin();
    return this.bookings.statsForTenant(id);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Provision a new operator (tenant + owner + roles)' })
  async provision(@Body(zodBody(ProvisionTenantSchema)) dto: ProvisionTenantDto) {
    this.assertPlatformAdmin();
    const result = await this.provisioning.provision(dto);
    const baseDomain = new URL(this.config.app.publicBaseUrl).hostname;
    return { ...result, slug: dto.slug, consoleUrl: `https://app.${dto.slug}.${baseDomain}` };
  }

  @Post(':id/suspend')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Suspend an operator' })
  async suspend(
    @Param('id') id: string,
    @Body(zodBody(SuspendTenantSchema)) dto: SuspendTenantDto,
  ) {
    this.assertPlatformAdmin();
    await this.provisioning.suspend(id as TenantId, dto.reason);
    return { ok: true };
  }

  @Post(':id/activate')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Re-activate a suspended operator' })
  async activate(@Param('id') id: string) {
    this.assertPlatformAdmin();
    await this.provisioning.activate(id as TenantId);
    return { ok: true };
  }

  @Get('plans')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'List every plan (active and inactive) — platform-admin catalogue' })
  async listPlans() {
    return { items: await this.plans.listAll() };
  }

  @Post('plans')
  @HttpCode(201)
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Create or update a plan (upserts on code)' })
  async createPlan(@Body(zodBody(PlanSchema)) dto: z.infer<typeof PlanSchema>) {
    this.assertPlatformAdmin();
    const id = await this.plans.create({
      code: dto.code,
      name: dto.name,
      monthlyPrice: dto.monthlyPrice,
      currency: dto.currency ?? 'INR',
      features: dto.features ?? {},
      quotas: dto.quotas ?? {},
      sortOrder: dto.sortOrder ?? 0,
    });
    return { id };
  }

  @Post('plans/:id/toggle-active')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary: 'Activate/deactivate a plan (existing tenants keep it; new signups no longer see it)',
  })
  async togglePlanActive(
    @Param('id') id: string,
    @Body(zodBody(z.object({ isActive: z.boolean() }))) dto: { isActive: boolean },
  ) {
    this.assertPlatformAdmin();
    await this.plans.setActive(id, dto.isActive);
    return { ok: true };
  }

  @Post(':id/plan')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: "Change an operator's plan" })
  async changePlan(
    @Param('id') id: string,
    @Body(zodBody(z.object({ planId: z.string().uuid() }))) dto: { planId: string },
  ) {
    this.assertPlatformAdmin();
    await this.tenants.changePlan(id, dto.planId);
    await this.tenantContext.invalidate(id as TenantId);
    return { ok: true };
  }

  @Put(':id/features/:feature')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      'Enable (true) / disable (false) a feature for ONE operator, or clear the override (null) to follow its plan',
  })
  async setFeature(
    @Param('id') id: string,
    @Param('feature') feature: string,
    @Body(zodBody(z.object({ enabled: z.boolean().nullable() }))) dto: { enabled: boolean | null },
  ) {
    this.assertPlatformAdmin();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(feature))
      throw new BadRequestError('Invalid feature key');
    await this.tenants.setFeatureOverride(id, feature, dto.enabled);
    await this.tenantContext.invalidate(id as TenantId);
    return { ok: true, feature, enabled: dto.enabled };
  }

  @Post('features/:feature/rollback')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      'Global rollback: remove this feature override from EVERY operator (all follow their plan again)',
  })
  async rollbackFeature(@Param('feature') feature: string) {
    this.assertPlatformAdmin();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(feature))
      throw new BadRequestError('Invalid feature key');
    const ids = await this.tenants.clearFeatureEverywhere(feature);
    await Promise.all(ids.map((t) => this.tenantContext.invalidate(t as TenantId)));
    return { ok: true, operatorsAffected: ids.length };
  }

  @Get('analytics')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      'Platform-wide numbers across EVERY operator — bookings, revenue, operator counts, 14-day trend',
  })
  async analytics() {
    this.assertPlatformAdmin();
    const [bookings, operators] = await Promise.all([
      this.bookings.platformStats(),
      this.tenants.countsByStatus(),
    ]);
    return { ...bookings, operators };
  }

  @Get('audit-log')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary: 'Cross-tenant audit trail — who did what, when (security/money-significant actions)',
  })
  async auditLog(
    @Query('tenantId') tenantId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
  ) {
    this.assertPlatformAdmin();
    return { entries: await this.audit.list({ tenantId, action, resourceType }) };
  }

  /**
   * Platform-wide monetization defaults — commission % and the per-bus fee.
   * Unlike a per-operator commission override (see PaymentController's
   * admin/commission endpoints), these apply UNIFORMLY: the default
   * commission is what an operator pays absent a negotiated override, and
   * the per-bus fee is the SAME ₹ amount for every operator, every time (not
   * negotiable per operator — raising/lowering it here changes it for
   * everyone at once, effective for newly-registered vehicles).
   */
  @Get('platform-settings')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      'Platform-wide defaults: commission %, per-bus one-time fee, ticket GST rate, commission GST rate, SMS/WhatsApp fees',
  })
  async platformSettingsGet() {
    this.assertPlatformAdmin();
    const [
      defaultCommissionPercent,
      perBusFeeMinor,
      gstRatePercent,
      commissionGstRatePercent,
      smsFeeMinor,
      whatsappFeeMinor,
    ] = await Promise.all([
      this.platformSettings.defaultCommissionPercent(),
      this.platformSettings.perBusFeeMinor(),
      this.platformSettings.gstRatePercent(),
      this.platformSettings.commissionGstRatePercent(),
      this.platformSettings.smsFeeMinor(),
      this.platformSettings.whatsappFeeMinor(),
    ]);
    return {
      defaultCommissionPercent,
      perBusFeeMinor,
      gstRatePercent,
      commissionGstRatePercent,
      smsFeeMinor,
      whatsappFeeMinor,
    };
  }

  @Post('platform-settings')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      'Update platform-wide defaults (effective immediately for anything not already overridden)',
  })
  async platformSettingsSet(
    @Body()
    dto: {
      defaultCommissionPercent?: number;
      perBusFeeMinor?: number;
      gstRatePercent?: number;
      commissionGstRatePercent?: number;
      smsFeeMinor?: number;
      whatsappFeeMinor?: number;
    },
  ) {
    this.assertPlatformAdmin();
    const actorId = getContext()?.userId ?? null;
    if (dto.defaultCommissionPercent !== undefined)
      await this.platformSettings.set(
        'default_commission_percent',
        dto.defaultCommissionPercent,
        actorId,
      );
    if (dto.perBusFeeMinor !== undefined)
      await this.platformSettings.set('per_bus_fee_minor', dto.perBusFeeMinor, actorId);
    if (dto.gstRatePercent !== undefined)
      await this.platformSettings.set('gst_rate_pct', dto.gstRatePercent, actorId);
    if (dto.commissionGstRatePercent !== undefined)
      await this.platformSettings.set(
        'commission_gst_rate_pct',
        dto.commissionGstRatePercent,
        actorId,
      );
    if (dto.smsFeeMinor !== undefined)
      await this.platformSettings.set('sms_fee_minor', dto.smsFeeMinor, actorId);
    if (dto.whatsappFeeMinor !== undefined)
      await this.platformSettings.set('whatsapp_fee_minor', dto.whatsappFeeMinor, actorId);
    return { ok: true };
  }

  /**
   * Disbursement — the actual bank-transfer side (see PayoutRepository's doc
   * comment for why this is separate from settlement). No payout API is
   * wired up yet: this generates a bank-compatible bulk-upload CSV that
   * staff download ONCE and upload to the bank's own corporate-netbanking
   * "bulk payment" feature (every major Indian bank supports this) — the
   * bank itself executes the actual NEFT/IMPS/RTGS transfers.
   */
  @Get('payouts/pending')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Payout instructions awaiting a bank file (not yet disbursed)' })
  async pendingPayouts() {
    this.assertPlatformAdmin();
    return { items: await this.payouts.listPending() };
  }

  @Get('payouts')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Full payout/disbursement history' })
  async allPayouts() {
    this.assertPlatformAdmin();
    return { items: await this.payouts.listAll() };
  }

  @Post('payouts/bank-file')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary: 'Generate a bank bulk-upload CSV for every pending payout, and mark them in-batch',
  })
  async generateBankFile() {
    this.assertPlatformAdmin();
    const pending = await this.payouts.listPending();
    if (pending.length === 0) return { csv: '', count: 0, totalMinor: 0 };

    const batchId = `${Date.now()}`;
    const header = 'Beneficiary Name,Account Number,IFSC Code,Amount,Currency,Narration';
    const rows = pending.map((p) =>
      [
        csvEscape(p.beneficiaryName),
        p.bankAccountNumber,
        p.bankIfsc,
        (p.amountMinor / 100).toFixed(2),
        p.currency,
        csvEscape(`Ticketly payout ${p.settlementId.slice(0, 8)}`),
      ].join(','),
    );
    await this.payouts.markInBatch(
      pending.map((p) => p.id),
      batchId,
    );

    return {
      csv: [header, ...rows].join('\n'),
      count: pending.length,
      totalMinor: pending.reduce((s, p) => s + p.amountMinor, 0),
      instructionIds: pending.map((p) => p.id),
    };
  }

  @Post('payouts/mark-sent')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Confirm the bank file was uploaded/submitted to the bank' })
  async markPayoutsSent(@Body() dto: { ids: string[] }) {
    this.assertPlatformAdmin();
    await this.payouts.markSent(dto.ids ?? []);
    return { ok: true };
  }

  @Post('payouts/:id/mark-confirmed')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: "Confirm the bank's statement/portal shows this transfer completed" })
  async markPayoutConfirmed(@Param('id') id: string) {
    this.assertPlatformAdmin();
    await this.payouts.markConfirmed(id);
    return { ok: true };
  }

  @Post('payouts/:id/mark-failed')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      'Mark a payout as failed/bounced (e.g. wrong account) — the operator needs to fix their bank details and the settlement re-instructed',
  })
  async markPayoutFailed(@Param('id') id: string, @Body() dto: { reason: string }) {
    this.assertPlatformAdmin();
    await this.payouts.markFailed(id, dto.reason);
    return { ok: true };
  }

  /**
   * Bank-detail CHANGE approval queue — an operator's request to update their
   * payout account does NOT take effect until approved here (anti-fraud
   * control: see PayoutRepository's doc comment). The account already on
   * file keeps receiving scheduled payouts in the meantime.
   */
  @Get('bank-changes/pending')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Bank-account change requests awaiting review' })
  async pendingBankChanges() {
    this.assertPlatformAdmin();
    return { items: await this.payouts.listPendingBankChangeRequests() };
  }

  @Post('bank-changes/:id/approve')
  @RequirePermission(Permission.ALL)
  @ApiOperation({
    summary:
      "Approve a bank-account change — becomes the operator's active payout account immediately",
  })
  async approveBankChange(@Param('id') id: string) {
    this.assertPlatformAdmin();
    await this.payouts.approveBankChange(id, getContext()?.userId ?? null);
    return { ok: true };
  }

  @Post('bank-changes/:id/reject')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Reject a bank-account change request' })
  async rejectBankChange(@Param('id') id: string, @Body() dto: { reason: string }) {
    this.assertPlatformAdmin();
    await this.payouts.rejectBankChange(id, getContext()?.userId ?? null, dto.reason);
    return { ok: true };
  }

  /**
   * Belt-and-braces: platform-admin actions must be performed by a NULL-tenant
   * super-admin principal, never by a tenant-scoped token that happens to hold
   * '*'. This closes the door on a tenant owner reaching cross-tenant routes.
   */
  private assertPlatformAdmin(): void {
    const ctx = getContext();
    if (ctx?.tenantId) {
      throw new ForbiddenError({
        message: 'Platform-admin actions require a platform (non-tenant) principal',
      });
    }
  }
}

/** Quote a CSV field only if it needs it (contains a comma, quote, or newline) — keeps the common case readable. */
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
