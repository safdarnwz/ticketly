import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import {
  ApiStandardErrors,
  RequirePermission,
  RequirePlatformAdmin,
  UuidParam,
  zodBody,
  zodQuery,
} from '@http';
import { BadRequestError } from '@kernel';

import { ContentService } from '../application/content.service';
import {
  CreateAnnouncementSchema,
  CreateBannerSchema,
  SaveOfferSchema,
  SavePageSchema,
  SlugSchema,
  UploadQuerySchema,
  type CreateAnnouncementDto,
  type CreateBannerDto,
  type SaveOfferDto,
  type SavePageDto,
  type UploadQueryDto,
} from './dto/content.dto';

/** Platform-admin management of storefront content. */
@ApiTags('admin-content')
@ApiBearerAuth('bearer')
@Controller({ path: 'content/admin', version: '1' })
@ApiStandardErrors()
@RequirePermission(Permission.ALL)
@RequirePlatformAdmin()
export class ContentAdminController {
  constructor(private readonly content: ContentService) {}

  @Get('pages')
  @ApiOperation({ summary: 'Every page, drafts included' })
  async pages() {
    return { items: await this.content.allPages() };
  }

  @Put('pages/:slug')
  @ApiOperation({
    summary:
      'Create or edit a page — the version and effective date move whenever the published text changes',
  })
  savePage(@Param('slug') slug: string, @Body(zodBody(SavePageSchema)) dto: SavePageDto) {
    return this.content.savePage(SlugSchema.parse(slug), dto);
  }

  @Post('uploads')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Upload a banner/offer image as raw bytes (Content-Type: application/octet-stream), JPG/PNG/WEBP ≤ 5 MB',
  })
  upload(@Query(zodQuery(UploadQuerySchema)) q: UploadQueryDto, @Body() body: Buffer) {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new BadRequestError(
        'Send the image as raw bytes with Content-Type: application/octet-stream',
      );
    return this.content.uploadImage(q.purpose, body, q.fileName);
  }

  @Post('banners')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a storefront banner' })
  async createBanner(@Body(zodBody(CreateBannerSchema)) dto: CreateBannerDto) {
    return { id: await this.content.createBanner(dto) };
  }

  @Patch('banners/:id')
  @ApiOperation({ summary: 'Show or hide a banner' })
  async setBanner(
    @UuidParam('id') id: string,
    @Body(zodBody(z.object({ isActive: z.boolean() }))) dto: { isActive: boolean },
  ) {
    await this.content.setBannerActive(id, dto.isActive);
    return { ok: true };
  }

  @Put('offers/:code')
  @ApiOperation({ summary: 'Create or update an offer by its code' })
  async saveOffer(
    @Param('code') code: string,
    @Body(zodBody(SaveOfferSchema.omit({ code: true }))) dto: Omit<SaveOfferDto, 'code'>,
  ) {
    return { id: await this.content.saveOffer({ ...dto, code }) };
  }

  @Get('announcements')
  @ApiOperation({ summary: 'Every announcement, past and present' })
  async announcements() {
    return { items: await this.content.allAnnouncements() };
  }

  @Post('announcements')
  @HttpCode(201)
  @ApiOperation({ summary: 'Broadcast an announcement to operators, customers or both' })
  async createAnnouncement(@Body(zodBody(CreateAnnouncementSchema)) dto: CreateAnnouncementDto) {
    return { id: await this.content.createAnnouncement(dto) };
  }

  @Delete('announcements/:id')
  @ApiOperation({ summary: 'Remove an announcement' })
  async deleteAnnouncement(@UuidParam('id') id: string) {
    await this.content.deleteAnnouncement(id);
    return { ok: true };
  }
}
