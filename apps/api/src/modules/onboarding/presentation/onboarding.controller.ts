import { Body, Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  Public,
  RateLimit,
  RequirePermission,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { getUserId } from '@kernel';

import { OnboardingService } from '../application/services/onboarding.service';
import {
  ApplicationDocumentQuerySchema,
  ApplyOperatorSchema,
  ApproveSchema,
  ListApplicationsQuerySchema,
  RejectSchema,
  type ApplicationDocumentQueryDto,
  type ApplyOperatorDto,
  type ApproveDto,
  type ListApplicationsQueryDto,
  type RejectDto,
} from './dto/onboarding.dto';

/**
 * Operator onboarding endpoints. `POST /operators/apply` is public (the
 * "Become an Operator" form on ticketly.com); the review endpoints are gated by
 * the platform-level `platform:operators` permission (super/platform admin).
 */
@ApiTags('onboarding')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /**
   * Applicant uploads each document BEFORE submitting the form (no account
   * exists yet). Stored in platform scope under _platform/kyc/applications/…,
   * private; the returned fileId goes into the application's `documents`.
   */
  @Public()
  @Post('operators/apply/documents')
  @HttpCode(201)
  @RateLimit(20, 3_600_000, 'ip')
  @ApiOperation({
    summary: 'Upload one application document as raw bytes (PDF/JPG/PNG/DOC/DOCX ≤ 5 MB)',
  })
  async uploadApplicationDocument(
    @Query(zodQuery(ApplicationDocumentQuerySchema)) q: ApplicationDocumentQueryDto,
    @Body() body: Buffer,
  ) {
    return this.onboarding.uploadApplicationDocument(q.docType, body, q.fileName);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/operator-applications/:id/documents/:docType')
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({ summary: 'Short-lived link to one application document' })
  async applicationDocument(@UuidParam('id') id: string, @Param('docType') docType: string) {
    return this.onboarding.applicationDocumentUrl(id, docType);
  }

  @Public()
  @Post('operators/apply')
  @HttpCode(201)
  @RateLimit(5, 60_000, 'ip')
  @ApiOperation({ summary: 'Apply to become an operator (public)' })
  async apply(@Body(zodBody(ApplyOperatorSchema)) dto: ApplyOperatorDto) {
    return this.onboarding.apply(dto);
  }

  @ApiBearerAuth('bearer')
  @Get('admin/operator-applications')
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({ summary: 'List operator applications (super/platform admin)' })
  async list(@Query(zodQuery(ListApplicationsQuerySchema)) q: ListApplicationsQueryDto) {
    return { applications: await this.onboarding.list(q.status) };
  }

  @ApiBearerAuth('bearer')
  @Get('admin/operator-applications/:id')
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({ summary: 'Full application detail incl. documents' })
  async get(@UuidParam('id') id: string) {
    return this.onboarding.get(id);
  }

  @ApiBearerAuth('bearer')
  @Post('admin/operator-applications/:id/approve')
  @HttpCode(200)
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({ summary: 'Approve → provision operator tenant + admin user' })
  async approve(@UuidParam('id') id: string, @Body(zodBody(ApproveSchema)) dto: ApproveDto) {
    return this.onboarding.approve(id, getUserId() ?? null, dto?.note);
  }

  @ApiBearerAuth('bearer')
  @Post('admin/operator-applications/:id/reject')
  @HttpCode(200)
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({ summary: 'Reject an application with a reason' })
  async reject(@UuidParam('id') id: string, @Body(zodBody(RejectSchema)) dto: RejectDto) {
    await this.onboarding.reject(id, dto.reason, getUserId() ?? null);
    return { ok: true };
  }

  @ApiBearerAuth('bearer')
  @Post('admin/operator-applications/:id/hold')
  @HttpCode(200)
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({
    summary:
      'Keep an application pending with a reason (e.g. more documents needed) — emailed to the applicant',
  })
  async hold(@UuidParam('id') id: string, @Body(zodBody(RejectSchema)) dto: RejectDto) {
    await this.onboarding.hold(id, dto.reason, getUserId() ?? null);
    return { ok: true };
  }

  @ApiBearerAuth('bearer')
  @Post('admin/operator-applications/:id/reopen')
  @HttpCode(200)
  @RequirePermission(Permission.PLATFORM_OPERATORS)
  @ApiOperation({ summary: 'Move a rejected application back to pending, with a reason' })
  async reopen(@UuidParam('id') id: string, @Body(zodBody(RejectSchema)) dto: RejectDto) {
    await this.onboarding.reopen(id, dto.reason, getUserId() ?? null);
    return { ok: true };
  }
}
