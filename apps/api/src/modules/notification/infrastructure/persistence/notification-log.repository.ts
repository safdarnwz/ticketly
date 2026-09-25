import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { newId, type TenantId, type Uuid } from '@kernel';

import type { Channel } from '../provider.interface';

/** notifications — one row per (event, channel, recipient): the delivery log and de-dupe key. */
@Injectable()
export class NotificationLogRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  /** Messages per channel and provider over a period (#112, #113), across every operator. */
  async deliveryStats(
    from: string,
    to: string,
  ): Promise<
    {
      channel: string;
      provider: string | null;
      total: number;
      sent: number;
      failed: number;
      pending: number;
    }[]
  > {
    return this.uow.run({ name: 'notification.deliveryStats', bypassRls: true }, async (scope) => {
      const { rows } = await scope.client.query<{
        channel: string;
        provider: string | null;
        total: string;
        sent: string;
        failed: string;
        pending: string;
      }>(
        `SELECT channel, provider, count(*) AS total,
                count(*) FILTER (WHERE status = 'sent') AS sent,
                count(*) FILTER (WHERE status = 'failed') AS failed,
                count(*) FILTER (WHERE status NOT IN ('sent', 'failed')) AS pending
           FROM notifications
          WHERE created_at >= $1::date AND created_at < $2::date + 1
          GROUP BY channel, provider ORDER BY channel, provider`,
        [from, to],
      );
      return rows.map((r) => ({
        channel: r.channel,
        provider: r.provider,
        total: Number(r.total),
        sent: Number(r.sent),
        failed: Number(r.failed),
        pending: Number(r.pending),
      }));
    });
  }

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
    /** A booking document (e-ticket, invoice): which booking, which document. */
    bookingId?: string;
    kind?: string;
  }): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO notifications (id, tenant_id, event_id, channel, recipient, subject, body, status, booking_id, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
       ON CONFLICT (event_id, channel, recipient) DO UPDATE SET status = 'pending'
         WHERE notifications.status = 'failed'
       RETURNING id`,
      [
        newId(),
        n.tenantId,
        n.eventId,
        n.channel,
        n.recipient,
        n.subject,
        n.body,
        n.bookingId ?? null,
        n.kind ?? null,
      ],
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

  /**
   * Latest delivery status of each document kind per booking, across every
   * operator — e.g. `{ eticket: 'sent', invoice: 'failed' }`.
   */
  async documentStatus(
    bookingIds: readonly string[],
  ): Promise<Map<string, Record<string, string>>> {
    const out = new Map<string, Record<string, string>>();
    if (bookingIds.length === 0) return out;
    await this.uow.run(
      { name: 'notification.documentStatus', bypassRls: true, readOnly: true },
      async (scope) => {
        const { rows } = await scope.client.query<{
          booking_id: string;
          kind: string;
          status: string;
        }>(
          `SELECT DISTINCT ON (booking_id, kind) booking_id, kind, status
             FROM notifications
            WHERE booking_id = ANY($1::uuid[]) AND kind IS NOT NULL
            ORDER BY booking_id, kind, created_at DESC`,
          [bookingIds],
        );
        for (const r of rows)
          out.set(r.booking_id, { ...out.get(r.booking_id), [r.kind]: r.status });
      },
    );
    return out;
  }
}
