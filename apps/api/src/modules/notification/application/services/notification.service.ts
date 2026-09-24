import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type TenantId, type Uuid } from '@kernel';
import { Logger } from '@observability';

import { renderTemplate } from '../../domain/template';
import { ProviderRegistry } from '../../infrastructure/provider-registry';
import type { Channel } from '../../infrastructure/provider.interface';
import { PlatformSettingsRepository } from '../../../tenancy/infrastructure/persistence/platform-settings.repository';

/**
 * Notification engine.
 *
 * Given an event type + data, it finds the tenant's active templates for each
 * channel, renders them, and dispatches through the matching provider (real
 * gateway if configured, logged otherwise — see ProviderRegistry) — logging
 * every send with a unique constraint on (event, channel, recipient) so a
 * retried outbox delivery is de-duplicated (idempotent, as the dispatcher
 * requires). A provider soft-failure marks the row `failed`; the outbox retries.
 *
 * SMS and WhatsApp are billed to the operator per message (₹0.07 / ₹0.10 plus
 * GST — see PlatformSettingsRepository.chargeNotification) — ONLY on a
 * successful send, never a failed one. Email is free.
 */
@Injectable()
export class NotificationService {
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
    private readonly providers: ProviderRegistry,
    private readonly platformSettings: PlatformSettingsRepository,
    logger: Logger,
  ) {
    this.log = logger.forContext('NotificationService');
  }

  async notify(input: {
    tenantId: TenantId;
    eventId: Uuid;
    eventType: string;
    recipients: Partial<Record<Channel, string>>;
    data: Record<string, string | number | undefined>;
  }): Promise<void> {
    const templates = await this.db.query<{
      channel: Channel;
      subject: string | null;
      body: string;
    }>(
      `SELECT channel, subject, body FROM notification_templates
        WHERE tenant_id = $1 AND event_type = $2 AND is_active = true`,
      [input.tenantId, input.eventType],
      { name: 'notify.templates', primary: true },
    );
    if (templates.length === 0) return;

    // Fetched once per call (same tenant for every template below) — used
    // ONLY for the email channel's From display-name, so a customer's
    // inbox shows the operator they actually booked with, not the
    // platform's own name for every single tenant's mail.
    const tenantRow = await this.db.queryOne<{ display_name: string }>(
      `SELECT display_name FROM tenants WHERE id = $1`,
      [input.tenantId],
      { name: 'notify.tenantDisplayName' },
    );

    for (const template of templates) {
      const recipient = input.recipients[template.channel];
      if (!recipient) continue;

      const body = renderTemplate(template.body, input.data);
      const subject = template.subject ? renderTemplate(template.subject, input.data) : null;

      // Idempotent insert: if this (event, channel, recipient) was already
      // logged, we've already sent it — skip.
      const inserted = await this.db.queryOne<{ id: string }>(
        `INSERT INTO notifications (id, tenant_id, event_id, channel, recipient, subject, body, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
         ON CONFLICT (event_id, channel, recipient) DO UPDATE SET status = 'pending'
           WHERE notifications.status = 'failed'
         RETURNING id`,
        [newId(), input.tenantId, input.eventId, template.channel, recipient, subject, body],
        { name: 'notify.logInsert', primary: true },
      );
      // No row back means one of two DIFFERENT things, not one: either
      // this exact notification was never attempted before (the INSERT
      // half just handled that — inserted would be set), OR a previous
      // attempt already reached 'sent' (the WHERE guard on the UPDATE
      // half correctly refuses to touch it). Only the SECOND case should
      // skip — a 'failed' row is exactly what the UPDATE half exists to
      // pick back up and retry, never to leave stuck as "already
      // processed" forever the way a bare ON CONFLICT DO NOTHING would.
      if (!inserted) continue;

      const provider = this.providers.forChannel(template.channel);
      const result = await provider.send({
        channel: template.channel,
        recipient,
        subject: subject ?? undefined,
        body,
        fromName: template.channel === 'email' ? tenantRow?.display_name : undefined,
      });

      await this.db.execute_(
        `UPDATE notifications SET status = $2, provider = $3, provider_ref = $4, sent_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [inserted.id, result.ok ? 'sent' : 'failed', provider.name, result.providerRef ?? null],
        { name: 'notify.logUpdate', primary: true },
      );
      if (!result.ok) {
        this.log.warn(
          {
            tenantId: input.tenantId,
            channel: template.channel,
            provider: provider.name,
            error: result.error,
          },
          'notification send failed; the outbox will retry',
        );
        // Throw so the outbox retries the whole event (and this de-dupes on retry).
        throw new Error(
          `Notification via ${template.channel} failed: ${result.error ?? 'unknown'}`,
        );
      }

      // Bill the operator ONLY for a message that actually sent — never a
      // failed attempt. Email has no equivalent setting (free), so this is a
      // no-op for that channel. Idempotent per notification (see
      // chargeNotification's unique index), so an outbox retry after this
      // point (e.g. a crash right after the throw above never happens since
      // we're past it, but a duplicate dispatch of the same event is still
      // possible) can never double-bill for the same message.
      if (template.channel === 'sms' || template.channel === 'whatsapp') {
        await this.platformSettings.chargeNotification(
          input.tenantId,
          template.channel,
          inserted.id,
        );
      }
    }
  }

  /** Seed default templates for a tenant (called at provisioning). */
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
}
