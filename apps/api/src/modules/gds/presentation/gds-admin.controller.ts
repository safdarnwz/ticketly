import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiStandardErrors,
  Idempotent,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';

import { GdsService } from '../application/gds.service';
import {
  CreatePartnerSchema,
  IssueKeySchema,
  ListPartnersQuerySchema,
  PartnerReceiptSchema,
  PartnerTermsSchema,
  PartnerWebhookSchema,
  SetPartnerStatusSchema,
  type CreatePartnerDto,
  type IssueKeyDto,
  type ListPartnersQueryDto,
  type PartnerReceiptDto,
  type PartnerTermsDto,
  type PartnerWebhookDto,
  type SetPartnerStatusDto,
} from './dto/gds.dto';

/** PLATFORM ADMIN: onboard OTAs / multi-operator agents, credit terms, receipts, API keys. */
@ApiTags('admin-gds')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/gds/partners', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class GdsAdminController {
  constructor(private readonly gds: GdsService) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(@Body(zodBody(CreatePartnerSchema)) dto: CreatePartnerDto) {
    return { id: await this.gds.createPartner(dto) };
  }
  @Get() async list(@Query(zodQuery(ListPartnersQuerySchema)) q: ListPartnersQueryDto) {
    return { items: await this.gds.listPartners(q.status) };
  }
  @Get(':id') detail(@UuidParam('id') id: string) {
    return this.gds.partnerDetail(id);
  }
  @Post(':id/status')
  @HttpCode(200)
  async status(
    @UuidParam('id') id: string,
    @Body(zodBody(SetPartnerStatusSchema)) dto: SetPartnerStatusDto,
  ) {
    await this.gds.setStatus(id, dto.status, dto.reason);
    return { ok: true };
  }
  @Put(':id/terms')
  async terms(
    @UuidParam('id') id: string,
    @Body(zodBody(PartnerTermsSchema)) dto: PartnerTermsDto,
  ) {
    await this.gds.setTerms(id, dto);
    return { ok: true };
  }
  @Post(':id/receipts')
  @HttpCode(200)
  @Idempotent()
  receipt(
    @UuidParam('id') id: string,
    @Body(zodBody(PartnerReceiptSchema)) dto: PartnerReceiptDto,
  ) {
    return this.gds.receipt(id, dto.amountMinor, dto.reference);
  }
  @Get(':id/webhook')
  @ApiOperation({ summary: "The partner's webhook endpoint and its recent deliveries" })
  webhook(@UuidParam('id') id: string) {
    return this.gds.partnerWebhook(id);
  }
  @Put(':id/webhook')
  @ApiOperation({
    summary: "Set/replace the partner's webhook endpoint — returns the NEW signing secret once",
  })
  setWebhook(
    @UuidParam('id') id: string,
    @Body(zodBody(PartnerWebhookSchema)) dto: PartnerWebhookDto,
  ) {
    return this.gds.setPartnerWebhook(id, dto);
  }
  @Delete(':id/webhook')
  @ApiOperation({ summary: "Remove the partner's webhook endpoint" })
  async removeWebhook(@UuidParam('id') id: string) {
    await this.gds.removePartnerWebhook(id);
    return { ok: true };
  }
  @Post(':id/webhook/test')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a signed test event to the partner endpoint now and report the response',
  })
  testWebhook(@UuidParam('id') id: string) {
    return this.gds.testPartnerWebhook(id);
  }
  @Post(':id/keys')
  @HttpCode(201)
  @ApiOperation({ summary: 'Issue an API key (returned ONCE). Sandbox keys are read-only.' })
  issueKey(@UuidParam('id') id: string, @Body(zodBody(IssueKeySchema)) dto: IssueKeyDto) {
    return this.gds.issueKey(id, dto);
  }
  @Delete(':id/keys/:keyId')
  async revoke(@UuidParam('id') id: string, @UuidParam('keyId') keyId: string) {
    await this.gds.revokeKey(id, keyId);
    return { ok: true };
  }
}
