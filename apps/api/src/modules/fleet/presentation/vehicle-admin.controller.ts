import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import {
  ApiStandardErrors,
  DownloadQuerySchema,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
  zodQuery,
  type DownloadQuery,
} from '@http';
import type { VehicleId } from '@kernel';

import { sendStoredFile } from '../../files';
import { VehicleVerificationService } from '../application/services/vehicle-verification.service';
import {
  OptionalNoteSchema,
  ReasonSchema,
  VerificationQueueQuerySchema,
  type OptionalNoteDto,
  type ReasonDto,
  type VerificationQueueQueryDto,
} from './dto/fleet.dto';

/**
 * Super-admin bus verification queue — across ALL operators. Every action
 * runs as the owning operator's tenant (so RLS and the audit trail stay
 * correct) after resolving it from the bus id.
 */
@ApiTags('admin-fleet')
@ApiBearerAuth('bearer')
@Controller({ path: 'admin/vehicles', version: '1' })
@ApiStandardErrors()
@RequirePlatformAdmin()
export class VehicleAdminController {
  constructor(private readonly verification: VehicleVerificationService) {}

  @Get()
  @ApiOperation({ summary: 'Verification queue (submitted first)' })
  async list(@Query(zodQuery(VerificationQueueQuerySchema)) q: VerificationQueueQueryDto) {
    return { items: await this.verification.adminList(q) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Bus details + every document + compliance + blockers' })
  async detail(@UuidParam('id') id: string) {
    return this.verification.adminDetail(id as VehicleId);
  }

  @Get(':id/documents/:docId/url')
  @ApiOperation({
    summary:
      'Short-lived signed link to a document (null when storage cannot sign — then use /file)',
  })
  async fileUrl(@UuidParam('id') id: string, @UuidParam('docId') docId: string) {
    const f = await this.verification.adminFileUrl(id as VehicleId, docId, false);
    return { url: f.url, fileName: f.meta.fileName, mimeType: f.meta.mimeType };
  }

  @Get(':id/documents/:docId/file')
  @ApiOperation({
    summary:
      'Open a document file (redirect to a short-lived signed link, or stream in dev storage)',
  })
  async file(
    @UuidParam('id') id: string,
    @UuidParam('docId') docId: string,
    @Query(zodQuery(DownloadQuerySchema)) { download }: DownloadQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const f = await this.verification.adminFileUrl(id as VehicleId, docId, download);
    if (f.url) {
      void reply.header('Cache-Control', 'no-store').redirect(f.url, 302);
      return;
    }
    sendStoredFile(
      reply,
      { fileName: f.meta.fileName, mimeType: f.meta.mimeType, content: await f.read() },
      download,
    );
  }

  @Post(':id/documents/:docId/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a document verified' })
  async verifyDoc(@UuidParam('id') id: string, @UuidParam('docId') docId: string) {
    return this.verification.adminVerifyDocument(id as VehicleId, docId, 'verified');
  }

  @Post(':id/documents/:docId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a document with a reason (operator re-uploads)' })
  async rejectDoc(
    @UuidParam('id') id: string,
    @UuidParam('docId') docId: string,
    @Body(zodBody(ReasonSchema)) dto: ReasonDto,
  ) {
    return this.verification.adminVerifyDocument(id as VehicleId, docId, 'rejected', dto.reason);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Activate the bus — only when every required document is verified and valid',
  })
  async approve(
    @UuidParam('id') id: string,
    @Body(zodBody(OptionalNoteSchema)) dto: OptionalNoteDto,
  ) {
    return this.verification.adminDecide(id as VehicleId, 'approved', dto?.reason);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the bus with a reason' })
  async reject(@UuidParam('id') id: string, @Body(zodBody(ReasonSchema)) dto: ReasonDto) {
    return this.verification.adminDecide(id as VehicleId, 'rejected', dto.reason);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suspend an approved bus with a reason — it is removed from all future trips',
  })
  async suspend(@UuidParam('id') id: string, @Body(zodBody(ReasonSchema)) dto: ReasonDto) {
    return this.verification.adminDecide(id as VehicleId, 'suspended', dto.reason);
  }
}
