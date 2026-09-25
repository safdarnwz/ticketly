import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, RequirePlatformAdmin, zodBody } from '@http';
import { getUserId } from '@kernel';

import { IntegrationAdminService } from '../application/integration-admin.service';
import {
  EnableIntegrationSchema,
  SaveIntegrationSchema,
  TestIntegrationSchema,
  type EnableIntegrationDto,
  type SaveIntegrationDto,
  type TestIntegrationDto,
} from './dto/integration-admin.dto';

@ApiTags('admin-platform')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/integrations', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class IntegrationAdminController {
  constructor(private readonly integrations: IntegrationAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'Payment, SMS, WhatsApp and SMTP integrations — secrets are masked, never returned',
  })
  async list() {
    return { items: await this.integrations.list() };
  }

  @Get(':provider')
  get(@Param('provider') provider: string) {
    return this.integrations.get(provider);
  }

  @Put(':provider')
  @ApiOperation({ summary: 'Save credentials (an omitted secret keeps its stored value)' })
  save(
    @Param('provider') provider: string,
    @Body(zodBody(SaveIntegrationSchema)) dto: SaveIntegrationDto,
  ) {
    return this.integrations.save(provider, dto, getUserId() ?? null);
  }

  @Post(':provider/enabled')
  @HttpCode(200)
  @ApiOperation({ summary: 'Enable or disable an integration (e.g. a payment gateway)' })
  setEnabled(
    @Param('provider') provider: string,
    @Body(zodBody(EnableIntegrationSchema)) dto: EnableIntegrationDto,
  ) {
    return this.integrations.setEnabled(provider, dto.enabled, getUserId() ?? null);
  }

  @Post(':provider/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a test SMS / WhatsApp / email (or verify gateway keys)' })
  test(
    @Param('provider') provider: string,
    @Body(zodBody(TestIntegrationSchema)) dto: TestIntegrationDto,
  ) {
    return this.integrations.test(provider, dto.to);
  }
}
