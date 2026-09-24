import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, Public, zodQuery } from '@http';

import { ContentService } from '../application/content.service';
import { PagesQuerySchema } from './dto/content.dto';
import type { PageKind } from '../domain/content';

/** Storefront content as the public (and operators) read it. */
@ApiTags('content')
@Controller({ path: 'content', version: '1' })
@ApiStandardErrors()
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('pages')
  @Public()
  @ApiOperation({
    summary: 'Published pages (?kind=legal for Terms, Privacy, Refund policy, Grievance officer)',
  })
  async pages(@Query(zodQuery(PagesQuerySchema)) q: { kind?: PageKind }) {
    return { items: await this.content.publishedPages(q.kind) };
  }

  @Get('pages/:slug')
  @Public()
  @ApiOperation({ summary: 'A published page by slug, with its version and effective date' })
  page(@Param('slug') slug: string) {
    return this.content.publishedPage(slug);
  }

  @Get('banners')
  @Public()
  @ApiOperation({ summary: 'Storefront banners active right now' })
  async banners() {
    return { items: await this.content.activeBanners() };
  }

  @Get('offers')
  @Public()
  @ApiOperation({ summary: 'Marketing offers live right now' })
  async offers() {
    return { items: await this.content.liveOffers() };
  }

  @Get('announcements/customers')
  @Public()
  @ApiOperation({ summary: 'Announcements shown to customers right now (most severe first)' })
  async customerAnnouncements() {
    return { items: await this.content.activeAnnouncements('customers') };
  }

  @Get('announcements/operators')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Announcements shown in the operator console right now (most severe first)',
  })
  async operatorAnnouncements() {
    return { items: await this.content.activeAnnouncements('operators') };
  }
}
