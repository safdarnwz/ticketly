import { Injectable } from '@nestjs/common';

import { newId } from '@kernel';
import { Logger } from '@observability';

import {
  signWebhookBody,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TEST_EVENT,
} from '../domain/webhook-event';
import { WebhookRepository, type WebhookTarget } from '../infrastructure/webhook.repository';
import { WebhookAudienceRegistry } from './webhook-audience.registry';

export interface WebhookAttemptResult {
  ok: boolean;
  responseStatus: number | null;
  error: string | null;
  latencyMs: number;
}

const TIMEOUT_MS = 10_000;

/**
 * Delivers signed event payloads to webhook endpoints.
 *
 * Signature (documented at GET /webhooks/catalogue):
 * `X-Ticketly-Signature: sha256=<hex>`, hex = HMAC_SHA256(endpoint secret,
 * raw JSON body) — the same scheme our inbound payment webhooks use.
 *
 * A receiver being down is routine, not a bug: failures are recorded and
 * retried by the worker's sweep (up to 5 attempts), never thrown.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly log: Logger;

  constructor(
    private readonly webhooks: WebhookRepository,
    private readonly audience: WebhookAudienceRegistry,
    logger: Logger,
  ) {
    this.log = logger.forContext('WebhookDelivery');
  }

  /** Fan one domain event out to the operator's endpoints and any GDS partner it concerns. */
  async deliverEvent(input: {
    tenantId: string;
    eventType: string;
    eventId: string;
    occurredAt: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const partnerIds = await this.audience.gdsPartnersFor(input);
    const targets = await this.webhooks.targetsFor(input.tenantId, partnerIds, input.eventType);
    const body = {
      event: input.eventType,
      eventId: input.eventId,
      occurredAt: input.occurredAt,
      data: input.payload,
    };
    for (const target of targets) {
      const deliveryId = await this.webhooks.enqueueDelivery({
        webhookId: target.id,
        tenantId: input.tenantId,
        eventType: input.eventType,
        eventId: input.eventId,
        payload: body,
      });
      if (!deliveryId) continue; // already queued for this (endpoint, event)
      await this.attemptLogged(deliveryId, target, body, 0);
    }
  }

  /** Re-attempt everything due for retry — called by the worker's scheduler. */
  async retryDue(): Promise<number> {
    const due = await this.webhooks.duePending();
    for (const d of due) await this.attemptLogged(d.id, d, d.payload, d.attempts);
    return due.length;
  }

  /**
   * Send a signed `webhook.test` ping right now and report what the receiver
   * answered (#64). Not written to the delivery log — it is a connectivity check.
   */
  async sendTest(target: WebhookTarget): Promise<WebhookAttemptResult> {
    return this.post(target, {
      event: WEBHOOK_TEST_EVENT,
      eventId: newId(),
      occurredAt: new Date().toISOString(),
      data: { message: 'Test delivery from Ticketly — verify the signature, then return 2xx.' },
    });
  }

  private async attemptLogged(
    deliveryId: string,
    target: WebhookTarget,
    body: unknown,
    attemptsSoFar: number,
  ): Promise<void> {
    const result = await this.post(target, body);
    if (result.ok) {
      await this.webhooks.markDelivered(deliveryId, result.responseStatus ?? 200);
      return;
    }
    await this.webhooks.markFailed(
      deliveryId,
      attemptsSoFar,
      result.error ?? 'failed',
      result.responseStatus ?? undefined,
    );
    this.log.warn(
      { url: target.url, status: result.responseStatus, error: result.error },
      'webhook delivery failed',
    );
  }

  private async post(target: WebhookTarget, payload: unknown): Promise<WebhookAttemptResult> {
    const body = JSON.stringify(payload);
    const started = Date.now();
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(target.secret, body),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return {
        ok: res.ok,
        responseStatus: res.status,
        error: res.ok ? null : `HTTP ${res.status}`,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        responseStatus: null,
        error: err instanceof Error ? err.message : 'network error',
        latencyMs: Date.now() - started,
      };
    }
  }
}
