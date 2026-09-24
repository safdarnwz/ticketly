import { Body, Controller, Delete, Get, Param, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, Public, RequirePermission } from '@http';
import { getUserId, getContext, ForbiddenError } from '@kernel';

import { AnnouncementRepository } from '../infrastructure/persistence/announcement.repository';

@ApiTags('announcements')
@Controller({ path: 'announcements', version: '1' })
@ApiStandardErrors()
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementRepository) {}

  @Post()
  @HttpCode(201)
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Create a platform-wide announcement (super-admin only)' })
  async create(
    @Body()
    dto: {
      title: string;
      body: string;
      severity?: 'info' | 'warning' | 'critical';
      audience?: 'operators' | 'customers' | 'all';
      startsAt?: string;
      endsAt?: string;
    },
  ) {
    this.assertPlatformAdmin();
    const id = await this.announcements.create({ ...dto, createdBy: getUserId() ?? null });
    return { id };
  }

  @Delete(':id')
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Remove an announcement' })
  async remove(@Param('id') id: string) {
    this.assertPlatformAdmin();
    await this.announcements.delete(id);
    return { ok: true };
  }

  @Get()
  @ApiBearerAuth('bearer')
  @RequirePermission(Permission.ALL)
  @ApiOperation({ summary: 'Every announcement, past and present (super-admin review)' })
  async listAll() {
    this.assertPlatformAdmin();
    return { items: await this.announcements.listAll() };
  }

  @Get('active/operators')
  @ApiOperation({
    summary:
      'Currently-active announcements for operators — shown as a banner in the operator console',
  })
  async activeForOperators() {
    return { items: await this.announcements.active('operators') };
  }

  @Get('active/customers')
  @Public()
  @ApiOperation({ summary: 'Currently-active announcements for customers' })
  async activeForCustomers() {
    return { items: await this.announcements.active('customers') };
  }

  private assertPlatformAdmin(): void {
    const ctx = getContext();
    if (ctx?.tenantId)
      throw new ForbiddenError({
        message: 'Platform-admin actions require a platform (non-tenant) principal',
      });
  }
}
