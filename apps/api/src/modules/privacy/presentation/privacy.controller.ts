import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  RequirePermission,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';

import { PrivacyService } from '../application/services/privacy.service';
import {
  ConsentSchema,
  ListErasureRequestsQuerySchema,
  type ConsentDto,
  type ListErasureRequestsQueryDto,
} from './dto/privacy.dto';

@ApiTags('privacy')
@ApiBearerAuth('bearer')
@Controller({ path: 'privacy', version: '1' })
@ApiStandardErrors()
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post('consents')
  @HttpCode(200)
  @ApiOperation({ summary: 'Grant or withdraw consent for a purpose' })
  async setConsent(@Body(zodBody(ConsentSchema)) dto: ConsentDto) {
    return this.privacy.setConsent(dto.purpose, dto.granted);
  }

  @Get('consents')
  @ApiOperation({ summary: 'My current consent state' })
  async myConsents() {
    return { consents: await this.privacy.myConsents() };
  }

  @Post('erasure-requests')
  @HttpCode(201)
  @ApiOperation({ summary: 'Request erasure of my personal data (right to be forgotten)' })
  async requestErasure() {
    return this.privacy.requestErasure();
  }

  @Get('erasure-requests')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'List erasure requests (platform)' })
  async list(@Query(zodQuery(ListErasureRequestsQuerySchema)) q: ListErasureRequestsQueryDto) {
    return { requests: await this.privacy.listErasureRequests(q.status) };
  }

  @Post('erasure-requests/:id/process')
  @HttpCode(200)
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'Fulfil an erasure request (anonymise PII, keep financials)' })
  async process(@UuidParam('id') id: string) {
    return this.privacy.processErasure(id);
  }
}
