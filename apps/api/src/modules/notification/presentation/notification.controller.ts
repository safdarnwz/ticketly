import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';

import { Permission } from '@contracts';
import { ApiStandardErrors, RequirePermission, zodBody } from '@http';

import { NotificationTemplateRepository } from '../infrastructure/persistence/notification-template.repository';
import { TEMPLATE_CATALOGUE } from '../domain/template-catalogue';
import { UpsertTemplateSchema, type UpsertTemplateDto } from './dto/notification.dto';

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@Controller({ path: 'notifications', version: '1' })
@ApiStandardErrors()
export class NotificationController {
  constructor(private readonly templates: NotificationTemplateRepository) {}

  @Get('templates')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'List notification templates' })
  async list() {
    // The catalogue tells the screen which events exist and what each fills in.
    return { items: await this.templates.list(), catalogue: TEMPLATE_CATALOGUE };
  }

  @Post('templates')
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Create or update a notification template' })
  async upsert(@Body(zodBody(UpsertTemplateSchema)) dto: UpsertTemplateDto) {
    await this.templates.upsert(dto);
    return { ok: true };
  }
}
