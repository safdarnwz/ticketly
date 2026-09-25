import { Injectable } from '@nestjs/common';

import { type TenantId, type Uuid } from '@kernel';
import { Logger } from '@observability';

import { renderTemplate } from '../../domain/template';
import { NotificationTemplateRepository } from '../../infrastructure/persistence/notification-template.repository';
import { ProviderRegistry } from '../../infrastructure/provider-registry';
import type { Channel } from '../../infrastructure/provider.interface';
import { PlatformBillingService } from '../../../platform-settings';
import { NotificationLogRepository } from '../../infrastructure/persistence/notification-log.repository';

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
 * GST — see PlatformBillingService.chargeNotification) — ONLY on a
 * successful send, never a failed one. Email is free.
 */
@Injectable()
export class NotificationService {
  private readonly log: Logger;

  constructor(
    private readonly deliveries: NotificationLogRepository,
    private readonly templates: NotificationTemplateRepository,
    private readonly providers: ProviderRegistry,
    private readonly billing: PlatformBillingService,
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
    const templates = await this.templates.activeFor(input.tenantId, input.eventType);
    if (templates.length === 0) return;

    // Fetched once per call (same tenant for every template below) — used
    // ONLY for the email channel's From display-name, so a customer's
    // inbox shows the operator they actually booked with, not the
    // platform's own name for every single tenant's mail.
    const senderName = await this.deliveries.operatorDisplayName(input.tenantId);

    for (const template of templates) {
      const recipient = input.recipients[template.channel];
      if (!recipient) continue;

      const body = renderTemplate(template.body, input.data);
      const subject = template.subject ? renderTemplate(template.subject, input.data) : null;

      // Idempotent insert: if this (event, channel, recipient) was already
      // logged, we've already sent it — skip.
      const logId = await this.deliveries.claim({
        tenantId: input.tenantId,
        eventId: input.eventId,
        channel: template.channel,
        recipient,
        subject,
        body,
      });
      // No row back means one of two DIFFERENT things, not one: either
      // this exact notification was never attempted before (the INSERT
      // half just handled that — inserted would be set), OR a previous
      // attempt already reached 'sent' (the WHERE guard on the UPDATE
      // half correctly refuses to touch it). Only the SECOND case should
      // skip — a 'failed' row is exactly what the UPDATE half exists to
      // pick back up and retry, never to leave stuck as "already
      // processed" forever the way a bare ON CONFLICT DO NOTHING would.
      if (!logId) continue;

      const provider = this.providers.forChannel(template.channel);
      const result = await provider.send({
        channel: template.channel,
        recipient,
        subject: subject ?? undefined,
        body,
        fromName: template.channel === 'email' ? (senderName ?? undefined) : undefined,
      });

      await this.deliveries.recordResult(logId, {
        ok: result.ok,
        provider: provider.name,
        providerRef: result.providerRef ?? null,
      });
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
        await this.billing.chargeNotification(input.tenantId, template.channel, logId);
      }
    }
  }

  /** Seed default templates for a tenant (called at provisioning). */
  async seedDefaults(
    tenantId: TenantId,
    defaults: { eventType: string; channel: string; subject?: string; body: string }[],
  ): Promise<void> {
    await this.templates.seedDefaults(tenantId, defaults);
  }
}
