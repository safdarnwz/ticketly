import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { DatabaseService, UnitOfWork } from '@database';
import { newId, requireTenantId } from '@kernel';

export interface DueDelivery {
  id: string;
  webhookId: string;
  url: string;
  secret: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  attempts: number;
}

export interface PartnerWebhook {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: Date;
}

/**
 * Partner webhook registration + delivery log, for the OTA/GDS distribution
 * surface. Tenant-scoped like everything else here (an operator manages
 * their OWN partner integrations) — the WORKER-side delivery consumer is the
 * one place that legitimately reaches across tenants (see
 * WebhookDeliveryService), since events arrive tagged with a tenant but no
 * ambient request context to bind one.
 */
@Injectable()
export class WebhookRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  /** Returns the plaintext secret ONCE — like an API key, it's never readable again. */
  async register(input: { name: string; url: string; eventTypes: string[]; createdBy: string | null }): Promise<{ id: string; secret: string }> {
    const id = newId();
    const secret = randomBytes(32).toString('hex');
    await this.db.execute_(
      `INSERT INTO partner_webhooks (id, tenant_id, name, url, secret, event_types, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, requireTenantId(), input.name, input.url, secret, input.eventTypes, input.createdBy],
      { name: 'webhook.register', primary: true },
    );
    return { id, secret };
  }

  async list(): Promise<PartnerWebhook[]> {
    return this.db.query(
      `SELECT id, name, url, event_types AS "eventTypes", is_active AS "isActive", created_at AS "createdAt"
         FROM partner_webhooks WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [requireTenantId()],
      { name: 'webhook.list', primary: true },
    );
  }

  async revoke(id: string): Promise<void> {
    await this.db.execute_(
      `UPDATE partner_webhooks SET revoked_at = now(), is_active = false WHERE id = $1 AND tenant_id = $2`,
      [id, requireTenantId()],
      { name: 'webhook.revoke', primary: true },
    );
  }

  async recentDeliveries(webhookId: string, limit = 20): Promise<unknown[]> {
    return this.db.query(
      `SELECT id, event_type AS "eventType", status, attempts, response_status AS "responseStatus",
              last_error AS "lastError", delivered_at AS "deliveredAt", created_at AS "createdAt"
         FROM webhook_deliveries WHERE webhook_id = $1 AND tenant_id = $2
        ORDER BY created_at DESC LIMIT $3`,
      [webhookId, requireTenantId(), Math.min(limit, 100)],
      { name: 'webhook.recentDeliveries', primary: true },
    );
  }

  // ── Worker-side (cross-tenant, no ambient request context) ────────────────

  /** Every active webhook for a tenant that subscribes to this event type (empty event_types = all). */
  async findActiveForTenant(tenantId: string, eventType: string): Promise<{ id: string; url: string; secret: string }[]> {
    return this.uow.run({ name: 'webhook.findActiveForTenant', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<{ id: string; url: string; secret: string }>(
        `SELECT id, url, secret FROM partner_webhooks
          WHERE tenant_id = $1 AND is_active = true AND revoked_at IS NULL
            AND (event_types = '{}' OR $2 = ANY(event_types))`,
        [tenantId, eventType],
      );
      return result.rows;
    });
  }

  /** Queue a delivery — idempotent per (webhook, event) via the unique index, so an at-least-once outbox replay never double-sends. */
  async enqueueDelivery(input: { webhookId: string; tenantId: string; eventType: string; eventId: string; payload: unknown }): Promise<string | null> {
    return this.uow.run({ name: 'webhook.enqueueDelivery', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<{ id: string }>(
        `INSERT INTO webhook_deliveries (id, webhook_id, tenant_id, event_type, event_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (webhook_id, event_id) DO NOTHING
         RETURNING id`,
        [newId(), input.webhookId, input.tenantId, input.eventType, input.eventId, JSON.stringify(input.payload)],
      );
      return result.rows[0]?.id ?? null;
    });
  }

  async markDelivered(deliveryId: string, responseStatus: number): Promise<void> {
    await this.uow.run({ name: 'webhook.markDelivered', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE webhook_deliveries SET status = 'delivered', response_status = $2, delivered_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [deliveryId, responseStatus],
      );
    });
  }

  /** Exponential-ish backoff: 1min, 5min, 30min, 3hr, then give up (status → 'failed') after 5 attempts. */
  async markFailed(deliveryId: string, attempts: number, error: string, responseStatus?: number): Promise<void> {
    const backoffMinutes = [1, 5, 30, 180][attempts] ?? null;
    await this.uow.run({ name: 'webhook.markFailed', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE webhook_deliveries
            SET attempts = attempts + 1, last_error = $2, response_status = $3,
                status = CASE WHEN $4::int IS NULL THEN 'failed' ELSE 'pending' END,
                next_attempt_at = CASE WHEN $4::int IS NULL THEN next_attempt_at ELSE now() + ($4::text || ' minutes')::interval END
          WHERE id = $1`,
        [deliveryId, error, responseStatus ?? null, backoffMinutes],
      );
    });
  }

  /** Deliveries due for a (re)try — for the worker's retry sweep. */
  async duePending(limit = 50): Promise<DueDelivery[]> {
    return this.uow.run({ name: 'webhook.duePending', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<DueDelivery>(
        `SELECT d.id, d.webhook_id AS "webhookId", w.url, w.secret, d.event_type AS "eventType",
                d.event_id AS "eventId", d.payload, d.attempts
           FROM webhook_deliveries d JOIN partner_webhooks w ON w.id = d.webhook_id
          WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND d.attempts < 5
          ORDER BY d.next_attempt_at LIMIT $1`,
        [Math.min(limit, 200)],
      );
      return result.rows;
    });
  }
}
