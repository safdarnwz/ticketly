import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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
import { getUserId, requireTenantId } from '@kernel';

import { PlatformInvoiceService } from '../application/platform-invoice.service';
import {
  CreateDiscountSchema,
  GenerateInvoiceSchema,
  InvoiceListQuerySchema,
  type CreateDiscountDto,
  type GenerateInvoiceDto,
  type InvoiceListQueryDto,
} from './dto/platform-billing.dto';

/** Platform invoices to operators (#100) and platform-level discounts (#101). */
@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/billing', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class PlatformBillingAdminController {
  constructor(private readonly billing: PlatformInvoiceService) {}

  @Post('invoices')
  @HttpCode(200)
  @Idempotent()
  @ApiOperation({
    summary:
      "Issue the platform's GST invoice to an operator for a closed period (returns the existing one if already issued)",
  })
  generate(@Body(zodBody(GenerateInvoiceSchema)) dto: GenerateInvoiceDto) {
    return this.billing.generate(dto, getUserId() ?? null);
  }

  @Get('invoices')
  async list(@Query(zodQuery(InvoiceListQuerySchema)) q: InvoiceListQueryDto) {
    return { items: await this.billing.list(q.tenantId ?? null) };
  }

  @Get('invoices/:id')
  get(@UuidParam('id') id: string) {
    return this.billing.get(id);
  }

  @Post('discounts')
  @HttpCode(201)
  @ApiOperation({ summary: 'Discount on platform invoices — one operator or every operator' })
  createDiscount(@Body(zodBody(CreateDiscountSchema)) dto: CreateDiscountDto) {
    return this.billing.createDiscount(dto, getUserId() ?? null);
  }

  @Get('discounts')
  async discounts(@Query(zodQuery(InvoiceListQuerySchema)) q: InvoiceListQueryDto) {
    return { items: await this.billing.listDiscounts(q.tenantId ?? null) };
  }

  @Delete('discounts/:id')
  async revokeDiscount(@UuidParam('id') id: string) {
    await this.billing.revokeDiscount(id);
    return { ok: true };
  }
}

/** An operator's own copy of the invoices the platform issued to it. */
@ApiTags('operator')
@ApiBearerAuth('bearer')
@Controller({ path: 'operator/platform-invoices', version: '1' })
@ApiStandardErrors()
export class OperatorPlatformInvoiceController {
  constructor(private readonly billing: PlatformInvoiceService) {}

  @Get()
  @RequirePermission(Permission.TENANT_READ)
  async list() {
    return { items: await this.billing.list(requireTenantId()) };
  }

  @Get(':id')
  @RequirePermission(Permission.TENANT_READ)
  get(@UuidParam('id') id: string) {
    return this.billing.get(id, requireTenantId());
  }
}
