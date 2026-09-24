import { Body, Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { z } from 'zod';

import { Permission } from '@contracts';
import { DatabaseService } from '@database';
import { ApiStandardErrors, RequirePermission, zodBody } from '@http';
import { newId, requireTenantId } from '@kernel';


const UpsertTemplateSchema = z.object({
  eventType: z.string().min(1).max(60),
  channel: z.enum(['sms', 'email', 'whatsapp', 'push']),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(2000),
});

@ApiTags('notifications')
@ApiBearerAuth('bearer')
@Controller({ path: 'notifications', version: '1' })
@ApiStandardErrors()
export class NotificationController {
  constructor(private readonly db: DatabaseService) {}

  @Get('templates')
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'List notification templates' })
  async list() {
    const items = await this.db.query(
      `SELECT event_type AS "eventType", channel, subject, body, is_active AS "isActive"
         FROM notification_templates WHERE tenant_id = $1 ORDER BY event_type, channel`,
      [requireTenantId()],
      { name: 'notify.listTemplates' },
    );
    return { items };
  }

  @Post('templates')
  @HttpCode(201)
  @RequirePermission(Permission.TENANT_MANAGE)
  @ApiOperation({ summary: 'Create or update a notification template' })
  async upsert(@Body(zodBody(UpsertTemplateSchema)) dto: z.infer<typeof UpsertTemplateSchema>) {
    await this.db.execute_(
      `INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, event_type, channel)
       DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()`,
      [newId(), requireTenantId(), dto.eventType, dto.channel, dto.subject ?? null, dto.body],
      { name: 'notify.upsertTemplate', primary: true },
    );
    return { ok: true };
  }
}
