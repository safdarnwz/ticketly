import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, requireTenantId, type TenantId } from '@kernel';

import type { Channel } from '../provider.interface';

export interface NotificationTemplate {
  eventType: string;
  channel: Channel;
  subject: string | null;
  body: string;
  isActive: boolean;
}

/** An operator's message templates, one per (event, channel). */
@Injectable()
export class NotificationTemplateRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<NotificationTemplate[]> {
    return this.db.query<NotificationTemplate>(
      `SELECT event_type AS "eventType", channel, subject, body, is_active AS "isActive"
         FROM notification_templates WHERE tenant_id = $1 ORDER BY event_type, channel`,
      [requireTenantId()],
      { name: 'notify.listTemplates' },
    );
  }

  async upsert(t: {
    eventType: string;
    channel: Channel;
    subject?: string;
    body: string;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, event_type, channel)
       DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()`,
      [newId(), requireTenantId(), t.eventType, t.channel, t.subject ?? null, t.body],
      { name: 'notify.upsertTemplate', primary: true },
    );
  }

  /** Insert defaults an operator doesn't have yet; never overwrites their edits. */
  async seedDefaults(
    tenantId: TenantId,
    defaults: { eventType: string; channel: string; subject?: string; body: string }[],
  ): Promise<void> {
    for (const t of defaults) {
      await this.db.execute_(
        `INSERT INTO notification_templates (id, tenant_id, event_type, channel, subject, body)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, event_type, channel) DO NOTHING`,
        [newId(), tenantId, t.eventType, t.channel, t.subject ?? null, t.body],
        { name: 'notify.seed', primary: true },
      );
    }
  }

  async activeFor(
    tenantId: TenantId,
    eventType: string,
  ): Promise<{ channel: Channel; subject: string | null; body: string }[]> {
    return this.db.query(
      `SELECT channel, subject, body FROM notification_templates
        WHERE tenant_id = $1 AND event_type = $2 AND is_active = true`,
      [tenantId, eventType],
      { name: 'notify.templates', primary: true },
    );
  }
}
