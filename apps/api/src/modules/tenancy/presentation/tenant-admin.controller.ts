import { Body, Controller, Get, Param, Post, Put, Query, HttpCode, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { AppConfig } from '@config';
import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Idempotent,
  RequirePermission,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { BadRequestError, csvField, getContext, type TenantId } from '@kernel';

import { AuditService } from '../../iam';
import { BookingRepository } from '../../booking';
import { PayoutRepository } from '../infrastructure/persistence/payout.repository';
import {
  ProvisionTenantSchema,
  type ProvisionTenantDto,
  SuspendTenantSchema,
  type SuspendTenantDto,
} from './dto/tenant.dto';
import {
  AuditLogExportQuerySchema,
  AuditLogQuerySchema,
  ChangePlanSchema,
  FeatureKeySchema,
  MarkPayoutsSentSchema,
  PlanSchema,
  PlatformSettingsSchema,
  ReasonSchema,
  SetDomainSchema,
  SetFaviconSchema,
  SetFeatureSchema,
  SetRateLimitSchema,
  SetPlanActiveSchema,
  type AuditLogExportQueryDto,
  type AuditLogQueryDto,
  type ChangePlanDto,
  type MarkPayoutsSentDto,
  type PlanDto,
  type PlatformSettingsDto,
  type ReasonDto,
  type SetDomainDto,
  type SetFaviconDto,
  type SetFeatureDto,
  type SetRateLimitDto,
  type SetPlanActiveDto,
} from './dto/tenant-admin.dto';
import { PlanRepository } from '../infrastructure/persistence/plan.repository';
import { TenantRateLimitService } from '../application/services/tenant-rate-limit.service';
import { TenantBrandingService } from '../application/services/tenant-branding.service';
import { TenantContextService } from '../application/services/tenant-context.service';
import { PlatformSettingsRepository } from '../../platform-settings';
import { TenantProvisioningService } from '../application/services/tenant-provisioning.service';
import { TenantRepository } from '../infrastructure/persistence/tenant.repository';

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
@RequirePermission(Permission.ALL)
@RequirePlatformAdmin()
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
    private readonly branding: TenantBrandingService,
    private readonly rateLimits: TenantRateLimitService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List every operator on the platform' })
  async list() {
    const rows = await this.tenants.list();
    const baseDomain = new URL(this.config.app.publicBaseUrl).hostname;
    return {
      items: rows.map((t) => ({ ...t, consoleUrl: `https://app.${t.slug}.${baseDomain}` })),
    };
  }

  @Get(':id/stats')
  @ApiOperation({
    summary:
      "One operator's booking numbers — total/today bookings, total/today cancellations, revenue",
  })
  async stats(@UuidParam('id') id: string) {
    return this.bookings.statsForTenant(id);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @ApiOperation({ summary: 'Provision a new operator (tenant + owner + roles)' })
  async provision(@Body(zodBody(ProvisionTenantSchema)) dto: ProvisionTenantDto) {
    const result = await this.provisioning.provision(dto);
    const baseDomain = new URL(this.config.app.publicBaseUrl).hostname;
    return { ...result, slug: dto.slug, consoleUrl: `https://app.${dto.slug}.${baseDomain}` };
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspend an operator' })
  async suspend(
    @UuidParam('id') id: string,
    @Body(zodBody(SuspendTenantSchema)) dto: SuspendTenantDto,
  ) {
    await this.provisioning.suspend(id as TenantId, dto.reason);
    return { ok: true };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Re-activate a suspended operator' })
  async activate(@UuidParam('id') id: string) {
    await this.provisioning.activate(id as TenantId);
    return { ok: true };
  }

  @Put(':id/domain')
  @ApiOperation({ summary: "Assign (or clear) an operator's custom booking domain" })
  setDomain(@UuidParam('id') id: string, @Body(zodBody(SetDomainSchema)) dto: SetDomainDto) {
    return this.branding.setDomain(id, dto.domain);
  }

  @Put(':id/rate-limit')
  @ApiOperation({ summary: "Set an operator's own API rate limit (null = platform default)" })
  setRateLimit(
    @UuidParam('id') id: string,
    @Body(zodBody(SetRateLimitSchema)) dto: SetRateLimitDto,
  ) {
    return this.rateLimits.set(id, dto.limit);
  }

  @Put(':id/favicon')
  @ApiOperation({ summary: "Set (or remove) an operator's white-label favicon" })
  async setFavicon(
    @UuidParam('id') id: string,
    @Body(zodBody(SetFaviconSchema)) dto: SetFaviconDto,
  ) {
    await this.branding.setFavicon(id, dto.dataUri);
    return { ok: true };
  }

  @Get('plans')
  @ApiOperation({ summary: 'List every plan (active and inactive) — platform-admin catalogue' })
  async listPlans() {
    return { items: await this.plans.listAll() };
  }

  @Post('plans')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create or update a plan (upserts on code)' })
  async createPlan(@Body(zodBody(PlanSchema)) dto: PlanDto) {
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
  @ApiOperation({
    summary: 'Activate/deactivate a plan (existing tenants keep it; new signups no longer see it)',
  })
  async togglePlanActive(
    @UuidParam('id') id: string,
    @Body(zodBody(SetPlanActiveSchema)) dto: SetPlanActiveDto,
  ) {
    await this.plans.setActive(id, dto.isActive);
    return { ok: true };
  }

  @Post(':id/plan')
  @ApiOperation({ summary: "Change an operator's plan" })
  async changePlan(
    @UuidParam('id') id: string,
    @Body(zodBody(ChangePlanSchema)) dto: ChangePlanDto,
  ) {
    await this.tenants.changePlan(id, dto.planId);
    await this.tenantContext.invalidate(id as TenantId);
    return { ok: true };
  }

  @Put(':id/features/:feature')
  @ApiOperation({
    summary:
      'Enable (true) / disable (false) a feature for ONE operator, or clear the override (null) to follow its plan',
  })
  async setFeature(
    @UuidParam('id') id: string,
    @Param('feature') feature: string,
    @Body(zodBody(SetFeatureSchema)) dto: SetFeatureDto,
  ) {
    if (!FeatureKeySchema.safeParse(feature).success)
      throw new BadRequestError('Invalid feature key');
    await this.tenants.setFeatureOverride(id, feature, dto.enabled);
    await this.tenantContext.invalidate(id as TenantId);
    return { ok: true, feature, enabled: dto.enabled };
  }

  @Post('features/:feature/rollback')
  @ApiOperation({
    summary:
      'Global rollback: remove this feature override from EVERY operator (all follow their plan again)',
  })
  async rollbackFeature(@Param('feature') feature: string) {
    if (!FeatureKeySchema.safeParse(feature).success)
      throw new BadRequestError('Invalid feature key');
    const ids = await this.tenants.clearFeatureEverywhere(feature);
    await Promise.all(ids.map((t) => this.tenantContext.invalidate(t as TenantId)));
    return { ok: true, operatorsAffected: ids.length };
  }

  @Get('analytics')
  @ApiOperation({
    summary:
      'Platform-wide numbers across EVERY operator — bookings, revenue, operator counts, 14-day trend',
  })
  async analytics() {
    const [bookings, operators] = await Promise.all([
      this.bookings.platformStats(),
      this.tenants.countsByStatus(),
    ]);
    return { ...bookings, operators };
  }

  @Get('audit-log')
  @ApiOperation({
    summary: 'Cross-tenant audit trail — who did what, when (security/money-significant actions)',
  })
  async auditLog(@Query(zodQuery(AuditLogQuerySchema)) q: AuditLogQueryDto) {
    return { entries: await this.audit.list(q) };
  }

  @Get('audit-log/export')
  @ApiOperation({
    summary:
      'Audit trail of the last N days (default 30, max 365) as CSV; X-Truncated: true when capped at 100 000 rows',
  })
  async auditLogExport(
    @Query(zodQuery(AuditLogExportQuerySchema)) q: AuditLogExportQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { csv, rows, truncated } = await this.audit.exportCsv(q);
    void reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="audit-log-${q.days}d.csv"`)
      .header('X-Row-Count', String(rows))
      .header('X-Truncated', String(truncated));
    return csv;
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
  @ApiOperation({
    summary:
      'Platform-wide defaults: commission %, per-bus one-time fee, ticket GST rate, commission GST rate, SMS/WhatsApp fees',
  })
  async platformSettingsGet() {
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
  @ApiOperation({
    summary:
      'Update platform-wide defaults (effective immediately for anything not already overridden)',
  })
  async platformSettingsSet(@Body(zodBody(PlatformSettingsSchema)) dto: PlatformSettingsDto) {
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
  @ApiOperation({ summary: 'Payout instructions awaiting a bank file (not yet disbursed)' })
  async pendingPayouts() {
    return { items: await this.payouts.listPending() };
  }

  @Get('payouts')
  @ApiOperation({ summary: 'Full payout/disbursement history' })
  async allPayouts() {
    return { items: await this.payouts.listAll() };
  }

  @Post('payouts/bank-file')
  @ApiOperation({
    summary: 'Generate a bank bulk-upload CSV for every pending payout, and mark them in-batch',
  })
  async generateBankFile() {
    const pending = await this.payouts.listPending();
    if (pending.length === 0) return { csv: '', count: 0, totalMinor: 0 };

    const batchId = `${Date.now()}`;
    const header = 'Beneficiary Name,Account Number,IFSC Code,Amount,Currency,Narration';
    const rows = pending.map((p) =>
      [
        csvField(p.beneficiaryName),
        p.bankAccountNumber,
        p.bankIfsc,
        (p.amountMinor / 100).toFixed(2),
        p.currency,
        csvField(`Ticketly payout ${p.settlementId.slice(0, 8)}`),
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
  @ApiOperation({ summary: 'Confirm the bank file was uploaded/submitted to the bank' })
  async markPayoutsSent(@Body(zodBody(MarkPayoutsSentSchema)) dto: MarkPayoutsSentDto) {
    await this.payouts.markSent(dto.ids);
    return { ok: true };
  }

  @Post('payouts/:id/mark-confirmed')
  @ApiOperation({ summary: "Confirm the bank's statement/portal shows this transfer completed" })
  async markPayoutConfirmed(@UuidParam('id') id: string) {
    await this.payouts.markConfirmed(id);
    return { ok: true };
  }

  @Post('payouts/:id/mark-failed')
  @ApiOperation({
    summary:
      'Mark a payout as failed/bounced (e.g. wrong account) — the operator needs to fix their bank details and the settlement re-instructed',
  })
  async markPayoutFailed(@UuidParam('id') id: string, @Body(zodBody(ReasonSchema)) dto: ReasonDto) {
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
  @ApiOperation({ summary: 'Bank-account change requests awaiting review' })
  async pendingBankChanges() {
    return { items: await this.payouts.listPendingBankChangeRequests() };
  }

  @Post('bank-changes/:id/approve')
  @ApiOperation({
    summary:
      "Approve a bank-account change — becomes the operator's active payout account immediately",
  })
  async approveBankChange(@UuidParam('id') id: string) {
    await this.payouts.approveBankChange(id, getContext()?.userId ?? null);
    return { ok: true };
  }

  @Post('bank-changes/:id/reject')
  @ApiOperation({ summary: 'Reject a bank-account change request' })
  async rejectBankChange(@UuidParam('id') id: string, @Body(zodBody(ReasonSchema)) dto: ReasonDto) {
    await this.payouts.rejectBankChange(id, getContext()?.userId ?? null, dto.reason);
    return { ok: true };
  }
}
