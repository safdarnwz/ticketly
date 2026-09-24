import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, UuidParam } from '@http';
import { UnitOfWork } from '@database';
import { NotFoundError, runAsTenant, type TenantId } from '@kernel';

import { PUBLIC_FILE_SQL, map, type Row } from '../infrastructure/stored-file.repository';

import { FileService } from '../application/file.service';
import { sendStoredFile } from './file-response';

@ApiTags('files')
@ApiBearerAuth('bearer')
@Controller({ path: '', version: '1' })
@ApiStandardErrors()
export class FileController {
  constructor(
    private readonly files: FileService,
    private readonly uow: UnitOfWork,
  ) {}

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
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('File', id);
    const row = await this.uow.run(
      { name: 'file.public', bypassRls: true },
      async (scope) => (await scope.client.query<Row>(PUBLIC_FILE_SQL, [id])).rows[0],
    );
    if (!row) throw new NotFoundError('File', id);
    const meta = map(row);
    const load = () => this.files.read(meta);
    const content = meta.tenantId
      ? await runAsTenant(meta.tenantId as TenantId, load)
      : await load();
    void reply.header('Cache-Control', 'public, max-age=86400');
    sendStoredFile(reply, { fileName: meta.fileName, mimeType: meta.mimeType, content });
  }

  @Get('files/:id/url')
  @RequirePermission(Permission.VEHICLE_READ)
  @ApiOperation({
    summary:
      "A short-lived link to one of this operator's files (CDN for public, signed for private)",
  })
  async url(@UuidParam('id') id: string, @Query('download') download?: string) {
    const meta = await this.files.meta(id);
    if (!meta) throw new NotFoundError('File', id);
    const url = await this.files.urlFor(meta, { download: download === '1' });
    return {
      url: url ?? `/api/v1/files/${meta.id}${download === '1' ? '?download=1' : ''}`,
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
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const meta = await this.files.meta(id);
    if (!meta) throw new NotFoundError('File', id);
    const url = await this.files.urlFor(meta, { download: download === '1' });
    if (url) {
      void reply.header('Cache-Control', 'no-store').redirect(url, 302);
      return;
    }
    sendStoredFile(
      reply,
      { fileName: meta.fileName, mimeType: meta.mimeType, content: await this.files.read(meta) },
      download === '1',
    );
  }
}
