import { Body, Controller, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission, RequirePlatformAdmin } from '@http';
import { AppError, ErrorCode } from '@kernel';

import { LegalRepository } from '../infrastructure/persistence/legal.repository';

/**
 * Publicly-readable legal pages (Terms, Privacy Policy, Refund Policy,
 * Grievance Officer) — required to be displayed under the Consumer
 * Protection (E-Commerce) Rules, 2020 and the IT Rules, 2021. See the
 * seeding migration's docstring for exactly which rule requires what.
 */
@ApiTags('legal')
@Controller({ path: 'legal', version: '1' })
@ApiStandardErrors()
export class LegalController {
  constructor(private readonly legal: LegalRepository) {}

  @Get(':slug')
  @Public()
  @ApiOperation({ summary: 'A published legal page by slug (terms, privacy, refund-policy, grievance)' })
  async page(@Param('slug') slug: string) {
    const page = await this.legal.getBySlug(slug);
    if (!page) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Page not found' });
    return page;
  }

  @Get()
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: 'All legal pages (super-admin review)' })
  async listAll() {
    return { items: await this.legal.listAll() };
  }

  @Post(':slug')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @RequirePlatformAdmin()
  @ApiOperation({ summary: "Edit a legal page (super-admin only — these are Ticketly-the-company's own compliance pages, not any operator's)" })
  async upsert(@Param('slug') slug: string, @Body() dto: { title: string; bodyMd: string }) {
    return this.legal.upsert(slug, dto.title, dto.bodyMd);
  }
}
