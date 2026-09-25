import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type TenantId, type Uuid } from '@kernel';

import type { Channel } from '../provider.interface';

/** notifications — one row per (event, channel, recipient): the delivery log and de-dupe key. */
@Injectable()
export class NotificationLogRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Claim a send. Returns the row id when this message should be sent now:
   * first time, or a retry of a failed attempt. Returns null when it was
   * already sent (or is being sent), so a redelivered event never sends twice.
   */
  async claim(n: {
    tenantId: TenantId;
    eventId: Uuid;
    channel: Channel;
    recipient: string;
    subject: string | null;
    body: string;
  }): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO notifications (id, tenant_id, event_id, channel, recipient, subject, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       ON CONFLICT (event_id, channel, recipient) DO UPDATE SET status = 'pending'
         WHERE notifications.status = 'failed'
       RETURNING id`,
      [newId(), n.tenantId, n.eventId, n.channel, n.recipient, n.subject, n.body],
      { name: 'notify.logInsert', primary: true },
    );
    return row?.id ?? null;
  }

  async recordResult(
    id: string,
    r: { ok: boolean; provider: string; providerRef: string | null },
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE notifications SET status = $2, provider = $3, provider_ref = $4, sent_at = now(),
              attempts = attempts + 1
        WHERE id = $1`,
      [id, r.ok ? 'sent' : 'failed', r.provider, r.providerRef],
      { name: 'notify.logUpdate', primary: true },
    );
  }

  /** The operator's display name — the From name on its emails. */
  async operatorDisplayName(tenantId: TenantId): Promise<string | null> {
    const row = await this.db.queryOne<{ display_name: string }>(
      `SELECT display_name FROM tenants WHERE id = $1`,
      [tenantId],
      { name: 'notify.tenantDisplayName' },
    );
    return row?.display_name ?? null;
  }
}
