import { Query, Body, Controller, Delete, Get, Patch, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FileService } from '../../files';
import { AppError, BadRequestError, ErrorCode, NotFoundError } from '@kernel';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  FileUploadQuerySchema,
  Public,
  RequirePermission,
  zodBody,
  zodQuery,
  type FileUploadQuery,
} from '@http';
import { requireTenantId } from '@kernel';

import {
  UpdateTenantSchema,
  type UpdateTenantDto,
  SetBankDetailsSchema,
  type SetBankDetailsDto,
  RefundPolicySchema,
  type RefundPolicyDto,
  SetLogoSchema,
  type SetLogoDto,
  SetInvoicePrefixSchema,
  type SetInvoicePrefixDto,
} from './dto/tenant.dto';
import { TenantBrandingService } from '../application/services/tenant-branding.service';
import { TenantContextService } from '../application/services/tenant-context.service';
import { TenantRepository } from '../infrastructure/persistence/tenant.repository';
import { PayoutRepository } from '../infrastructure/persistence/payout.repository';
import { UnitOfWork } from '@database';
import { getUserId } from '@kernel';
import { DEFAULT_REFUND_POLICY } from '../../booking';

/**
 * The operator's own settings surface (tenant-scoped). Unlike the admin
 * controller, everything here is automatically confined to the caller's tenant
 * by the ambient scope + RLS.
 */
@ApiTags('operator')
@ApiBearerAuth('bearer')
@Controller({ path: 'operator', version: '1' })
@ApiStandardErrors()
export class TenantController {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly tenantContext: TenantContextService,
    private readonly payouts: PayoutRepository,
    private readonly uow: UnitOfWork,
    private readonly files: FileService,
    private readonly brandingService: TenantBrandingService,
  ) {}

  @Get('profile')
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({ summary: 'Current operator profile, contacts, address & enabled features' })
  async profile() {
    const tenantId = requireTenantId();
    const [profile, details] = await Promise.all([
      this.tenantContext.getProfile(tenantId),
      this.tenants.contactDetails(tenantId),
    ]);
    return {
      tenantId: profile.tenantId,
      slug: profile.slug,
      displayName: profile.displayName,
      status: profile.status,
      timezone: profile.timezone,
      currency: profile.currency,
      locale: profile.locale,
      features: [...profile.features],
      quotas: profile.quotas,
      ...details,
    };
  }

  @Patch('profile')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      'Update the company profile: name, contacts, address, time zone (legal name / GSTIN are set by the platform)',
  })
  async update(@Body(zodBody(UpdateTenantSchema)) dto: UpdateTenantDto) {
    const tenantId = requireTenantId();
    const { secondaryContact, address, ...core } = dto;
    await this.uow.run({ name: 'tenant.updateProfile', tenantId }, async () => {
      const tenant = await this.tenants.findById(tenantId);
      if (!tenant) throw new NotFoundError('Operator', tenantId);
      if (
        core.currency &&
        core.currency !== tenant.snapshot().currency &&
        (await this.tenants.hasBookings(tenantId))
      )
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'The currency cannot change once you have bookings',
        });
      tenant.updateProfile(core);
      await this.tenants.update(tenant, tenant.version);
      // After the entity write, which saves the settings it loaded.
      if (secondaryContact !== undefined || address)
        await this.tenants.setContactExtras({ secondaryContact, address });
    });
    await this.tenantContext.invalidate(tenantId);
    return { ok: true };
  }

  @Get('bank-details')
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({
    summary:
      "This operator's ACTIVE payout bank account, plus any pending change request under review",
  })
  async bankDetails() {
    const tenantId = requireTenantId();
    const [details, pending] = await Promise.all([
      this.tenants.getBankDetails(),
      this.payouts.pendingBankChangeRequest(tenantId),
    ]);
    return {
      onFile: !!details?.accountNumber,
      accountHolder: details?.accountHolder,
      accountNumberMasked: details?.accountNumber
        ? `••••${details.accountNumber.slice(-4)}`
        : undefined,
      ifsc: details?.ifsc,
      bankName: details?.bankName,
      updatedAt: details?.updatedAt,
      pendingRequest: pending
        ? {
            accountHolder: pending.accountHolder,
            accountNumberMasked: `••••${pending.accountNumber.slice(-4)}`,
            ifsc: pending.ifsc,
            submittedAt: pending.createdAt,
          }
        : null,
    };
  }

  @Patch('bank-details')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      'Request a change to the payout bank account — takes effect ONLY once the platform approves it; the current account keeps receiving scheduled payouts until then',
  })
  async setBankDetails(@Body(zodBody(SetBankDetailsSchema)) dto: SetBankDetailsDto) {
    const tenantId = requireTenantId();
    const [current, pending] = await Promise.all([
      this.tenants.getBankDetails(),
      this.payouts.pendingBankChangeRequest(tenantId),
    ]);
    const same = (a?: { accountNumber: string | null; ifsc: string | null } | null) =>
      a?.accountNumber === dto.accountNumber && a?.ifsc?.toUpperCase() === dto.ifsc;
    if (same(current))
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'This is already your payout account',
      });
    if (same(pending))
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'This account is already waiting for approval',
      });
    const requestId = await this.payouts.submitBankChangeRequest(
      tenantId,
      getUserId() ?? null,
      dto,
    );
    return { ok: true, requestId, status: 'pending' };
  }

  @Delete('bank-details/pending')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Withdraw the payout-account change waiting for approval' })
  async withdrawBankChange() {
    if (!(await this.payouts.withdrawBankChangeRequest(requireTenantId())))
      throw new NotFoundError('Pending bank change', 'current');
    return { ok: true };
  }

  @Get('refund-policy')
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({
    summary:
      "This operator's cancellation/refund tiers, or the platform default if they haven't set their own",
  })
  async getRefundPolicy() {
    const custom = await this.tenants.getRefundPolicy();
    return { policy: custom ?? DEFAULT_REFUND_POLICY, isCustom: custom !== null };
  }

  @Patch('refund-policy')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      "Set this operator's own cancellation/refund tiers — takes effect immediately for any cancellation from this point on (never retroactive)",
  })
  async setRefundPolicy(@Body(zodBody(RefundPolicySchema)) dto: RefundPolicyDto) {
    await this.tenants.setRefundPolicy(dto);
    return { ok: true, policy: dto };
  }

  @Post('refund-policy/reset')
  @HttpCode(200)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Revert to the platform default cancellation/refund policy' })
  async resetRefundPolicy() {
    await this.tenants.setRefundPolicy(null);
    return { ok: true, policy: DEFAULT_REFUND_POLICY };
  }

  @Get('branding')
  @Public()
  @ApiOperation({
    summary:
      "The operator's public branding (name, logo, favicon, domain) for the site it is served on",
  })
  branding() {
    return this.brandingService.branding(requireTenantId());
  }

  @Get('logo')
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({
    summary: "This operator's logo (as a data URI) — shown on e-tickets, invoices, etc.",
  })
  async getLogo() {
    return { dataUri: await this.tenants.getLogoUrl() };
  }

  @Patch('logo')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      "Set this operator's own logo — appears on e-tickets and GST invoices going forward (not retroactive on already-issued documents)",
  })
  async setLogo(@Body(zodBody(SetLogoSchema)) dto: SetLogoDto) {
    await this.tenants.setLogoUrl(dto.dataUri);
    return { ok: true };
  }

  @Post('logo/upload')
  @HttpCode(200)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      'Upload the operator logo as raw bytes (PNG/JPG/WEBP/SVG ≤ 2 MB) → {operator}/branding/logo.<ext> in object storage',
  })
  async uploadLogo(
    @Query(zodQuery(FileUploadQuerySchema)) { fileName }: FileUploadQuery,
    @Body() body: Buffer,
  ) {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestError(
        'Send the logo as raw bytes with Content-Type: application/octet-stream',
      );
    const f = await this.files.upload({
      purpose: 'tenant_logo',
      bytes: body,
      fileName,
      fixedName: 'logo',
    });
    // E-tickets and PDF invoices embed the logo inline (no network fetch at
    // render time), so a small copy is kept as a data URI as well.
    const dataUri =
      body.length <= 500 * 1024 ? `data:${f.mimeType};base64,${body.toString('base64')}` : null;
    if (dataUri) await this.tenants.setLogoUrl(dataUri);
    await this.tenants.setLogoFile({ fileId: f.id, objectKey: f.objectKey, url: f.url });
    return { ok: true, url: f.url, fileId: f.id, embeddedInDocuments: !!dataUri };
  }

  @Get('invoice-prefix')
  @RequirePermission(Permission.TENANT_READ)
  @ApiOperation({
    summary:
      "This operator's own GST invoice-number prefix, or the platform default ('INV') if never set",
  })
  async getInvoicePrefix() {
    const prefix = await this.tenants.getInvoicePrefix();
    return { prefix: prefix ?? '', isCustom: !!prefix };
  }

  @Patch('invoice-prefix')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({
    summary:
      'Set this operator\'s own GST invoice-number prefix (e.g. "SPB" -> SPB/2026-27/000042) — future invoices only, never renumbers past ones',
  })
  async setInvoicePrefix(@Body(zodBody(SetInvoicePrefixSchema)) dto: SetInvoicePrefixDto) {
    await this.tenants.setInvoicePrefix(dto.prefix);
    return { ok: true };
  }
}
