import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

import { Logger } from '@observability';

import { WebhookRepository } from '../../infrastructure/webhook.repository';

/**
 * Delivers a signed event payload to a partner's registered URL.
 *
 * Signature scheme (documented to partners via DistributionController's
 * catalogue endpoint): `X-Ticketly-Signature: sha256=<hex>`, where the hex is
 * `HMAC_SHA256(webhook.secret, rawJsonBody)` — the SAME scheme our own
 * inbound payment-webhook verification uses (MockGateway/RazorpayGateway),
 * so partners implementing "verify a signed webhook" once can reuse that
 * code for both directions.
 *
 * Failures are NOT thrown to the caller — a partner's server being down is
 * an expected, routine condition, not a bug in ours. `WebhookRepository`
 * tracks attempts/backoff; the worker's retry sweep re-attempts pending
 * deliveries up to 5 times before giving up.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly log: Logger;

  constructor(
    private readonly webhooks: WebhookRepository,
    logger: Logger,
  ) {
    this.log = logger.forContext('WebhookDelivery');
  }

  /** Fan out one event to every active webhook a tenant has registered for it. */
  async deliverToTenant(
    tenantId: string,
    eventType: string,
    eventId: string,
    payload: unknown,
  ): Promise<void> {
    const targets = await this.webhooks.findActiveForTenant(tenantId, eventType);
    for (const target of targets) {
      const deliveryId = await this.webhooks.enqueueDelivery({
        webhookId: target.id,
        tenantId,
        eventType,
        eventId,
        payload,
      });
      if (!deliveryId) continue; // already enqueued for this (webhook, event) — at-least-once dedupe
      await this.attempt(deliveryId, target.url, target.secret, payload, 0);
    }
  }

  /** Re-attempt everything due for retry — called by the worker's scheduler sweep. */
  async retryDue(): Promise<number> {
    const due = await this.webhooks.duePending();
    for (const d of due) {
      await this.attempt(d.id, d.url, d.secret, d.payload, d.attempts);
    }
    return due.length;
  }

  private async attempt(
    deliveryId: string,
    url: string,
    secret: string,
    payload: unknown,
    attemptsSoFar: number,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ticketly-Signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await this.webhooks.markDelivered(deliveryId, res.status);
      } else {
        await this.webhooks.markFailed(deliveryId, attemptsSoFar, `HTTP ${res.status}`, res.status);
        this.log.warn({ url, status: res.status }, 'webhook delivery rejected by partner');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'network error';
      await this.webhooks.markFailed(deliveryId, attemptsSoFar, message);
      this.log.warn({ url, error: message }, 'webhook delivery failed');
    }
  }
}
