import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  DownloadQuerySchema,
  Public,
  RequirePermission,
  UuidParam,
  zodQuery,
  type DownloadQuery,
} from '@http';
import { NotFoundError, runAsTenant, type TenantId } from '@kernel';

import { FileService } from '../application/file.service';
import { sendStoredFile } from './file-response';

@ApiTags('files')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class FileController {
  constructor(private readonly files: FileService) {}

  /**
   * PUBLIC files only (logos, bus photos, banners) — used when there is
   * no CDN domain configured (dev). Private documents are never reachable here.
   */
  @Get('public/files/:id')
  @Public()
  @ApiOperation({
    summary: 'Serve a PUBLIC file (logo / bus photo / banner) when no CDN is configured',
  })
  async publicFile(@UuidParam('id') id: string, @Res() reply: FastifyReply): Promise<void> {
    const meta = await this.files.publicMeta(id);
    if (!meta) throw new NotFoundError('File', id);
    const load = () => this.files.read(meta);
    const content = meta.tenantId
      ? await runAsTenant(meta.tenantId as TenantId, load)
      : await load();
    void reply.header('Cache-Control', 'public, max-age=86400');
    // Public by design: the web app, storefronts and emails embed these from another origin.
    void reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    sendStoredFile(reply, { fileName: meta.fileName, mimeType: meta.mimeType, content });
  }

  @Get('files/:id/url')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({
    summary:
      "A short-lived link to one of this operator's files (CDN for public, signed for private)",
  })
  async url(
    @UuidParam('id') id: string,
    @Query(zodQuery(DownloadQuerySchema)) { download }: DownloadQuery,
  ) {
    const meta = await this.files.meta(id);
    if (!meta) throw new NotFoundError('File', id);
    const url = await this.files.urlFor(meta, { download });
    return {
      url: url ?? `/api/v1/files/${meta.id}${download ? '?download=1' : ''}`,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
    };
  }

  @Get('files/:id')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({
    summary:
      "Open one of this operator's files — redirects to the storage link, or streams it (dev storage)",
  })
  async open(
    @UuidParam('id') id: string,
    @Query(zodQuery(DownloadQuerySchema)) { download }: DownloadQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const meta = await this.files.meta(id);
    if (!meta) throw new NotFoundError('File', id);
    const url = await this.files.urlFor(meta, { download });
    if (url) {
      void reply.header('Cache-Control', 'no-store').redirect(url, 302);
      return;
    }
    sendStoredFile(
      reply,
      { fileName: meta.fileName, mimeType: meta.mimeType, content: await this.files.read(meta) },
      download,
    );
  }
}
