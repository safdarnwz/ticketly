import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { type TenantId, type Uuid } from '@kernel';
import { Logger } from '@observability';

import { renderTemplate } from '../../domain/template';
import { NotificationTemplateRepository } from '../../infrastructure/persistence/notification-template.repository';
import { ProviderRegistry } from '../../infrastructure/provider-registry';
import type { Channel } from '../../infrastructure/provider.interface';
import { PlatformBillingService } from '../../../platform-settings';
import { NotificationLogRepository } from '../../infrastructure/persistence/notification-log.repository';
import { Mailer } from '../../infrastructure/mail/mailer';

/** The emails a booking's customer receives as documents, each once. */
export type BookingDocumentKind = 'eticket' | 'invoice';

/**
 * A stable id for one document of one event: the delivery log de-dupes on
 * (event, channel, recipient), and the e-ticket and the invoice are two
 * different emails to the same address for the same event.
 */
export function documentEventId(eventId: string, kind: BookingDocumentKind): Uuid {
  const h = createHash('sha1').update(`${eventId}:${kind}`).digest('hex');
  // RFC 4122 layout, version 5 (name-based, SHA-1), variant 10xx.
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}` as Uuid;
}

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
    private readonly mailer: Mailer,
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

  /**
   * The operator's own wording for an event on one channel (subject + body),
   * rendered — or null when it has none (or switched it off).
   */
  async renderOperatorTemplate(
    tenantId: TenantId,
    eventType: string,
    channel: Channel,
    data: Record<string, string | number | undefined>,
  ): Promise<{ subject: string | null; body: string } | null> {
    const t = (await this.templates.activeFor(tenantId, eventType)).find(
      (x) => x.channel === channel,
    );
    if (!t) return null;
    return {
      subject: t.subject ? renderTemplate(t.subject, data) : null,
      body: renderTemplate(t.body, data),
    };
  }

  /**
   * Email one of a booking's documents (e-ticket, GST invoice) — logged
   * against the booking so the platform sees whether it went out, sent at
   * most once per event however often the event is redelivered, and retried
   * (by throwing, so the outbox redelivers) when the mail server refuses it.
   * From-name is the operator's. Returns false when it was already sent.
   */
  async sendBookingDocument(input: {
    tenantId: TenantId;
    eventId: Uuid;
    bookingId: string;
    kind: BookingDocumentKind;
    to: string;
    subject: string;
    html: string;
    text: string;
    attachments?: { filename: string; content: Buffer; contentType?: string; cid?: string }[];
  }): Promise<boolean> {
    const logId = await this.deliveries.claim({
      tenantId: input.tenantId,
      eventId: documentEventId(input.eventId, input.kind),
      channel: 'email',
      recipient: input.to,
      subject: input.subject,
      body: input.text,
      bookingId: input.bookingId,
      kind: input.kind,
    });
    if (!logId) return false;
    const fromName = (await this.deliveries.operatorDisplayName(input.tenantId)) ?? undefined;
    let provider: string;
    try {
      provider = await this.mailer.send({
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        fromName,
        attachments: input.attachments,
      });
    } catch (error) {
      await this.deliveries.recordResult(logId, { ok: false, provider: 'smtp', providerRef: null });
      this.log.warn(
        { tenantId: input.tenantId, bookingId: input.bookingId, kind: input.kind, err: error },
        'booking document email failed; the outbox will retry',
      );
      throw error;
    }
    // 'log' = no mail server configured (local development): recorded, not delivered.
    await this.deliveries.recordResult(logId, { ok: true, provider, providerRef: null });
    return true;
  }

  /** Per booking, the latest delivery status of each document email (`{ eticket: 'sent' }`). */
  documentStatus(bookingIds: readonly string[]): Promise<Map<string, Record<string, string>>> {
    return this.deliveries.documentStatus(bookingIds);
  }

  /** Seed default templates for a tenant (called at provisioning). */
  async seedDefaults(
    tenantId: TenantId,
    defaults: { eventType: string; channel: string; subject?: string; body: string }[],
  ): Promise<void> {
    await this.templates.seedDefaults(tenantId, defaults);
  }
}
