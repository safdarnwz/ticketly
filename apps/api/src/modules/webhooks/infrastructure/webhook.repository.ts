import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { newId, requireTenantId } from '@kernel';

import { nextRetryMinutes } from '../domain/webhook-event';

export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: Date;
}

export interface WebhookTarget {
  id: string;
  url: string;
  secret: string;
}

export interface DueDelivery extends WebhookTarget {
  webhookId: string;
  eventType: string;
  eventId: string;
  payload: unknown;
  attempts: number;
}

export interface WebhookDelivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

const ENDPOINT_COLUMNS = `id, name, url, event_types AS "eventTypes", is_active AS "isActive", created_at AS "createdAt"`;
/** Delivery-log columns; `d` is the webhook_deliveries alias. */
const DELIVERY_COLUMNS = `d.id, d.event_type AS "eventType", d.status, d.attempts, d.response_status AS "responseStatus",
  d.last_error AS "lastError", d.delivered_at AS "deliveredAt", d.created_at AS "createdAt"`;

/**
 * Webhook endpoints and their delivery log.
 *
 * An endpoint belongs to EITHER an operator (tenant-scoped, managed from the
 * operator console) OR a platform GDS partner (managed by the platform admin).
 * Operator methods run in the caller's tenant scope (RLS); partner and
 * worker-side methods reach across tenants with bypassRls, because events
 * arrive tagged with a tenant but without a request context.
 */
@Injectable()
export class WebhookRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  /* ── operator endpoints ───────────────────────────────────────────── */

  /** Returns the signing secret ONCE — like an API key, it is never readable again. */
  async registerForTenant(input: {
    name: string;
    url: string;
    eventTypes: string[];
    createdBy: string | null;
  }): Promise<{ id: string; secret: string }> {
    const id = newId();
    const secret = newSecret();
    await this.db.execute_(
      `INSERT INTO partner_webhooks (id, tenant_id, name, url, secret, event_types, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, requireTenantId(), input.name, input.url, secret, input.eventTypes, input.createdBy],
      { name: 'webhook.registerForTenant', primary: true },
    );
    return { id, secret };
  }

  async listForTenant(): Promise<WebhookEndpoint[]> {
    return this.db.query<WebhookEndpoint>(
      `SELECT ${ENDPOINT_COLUMNS} FROM partner_webhooks
        WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [requireTenantId()],
      { name: 'webhook.listForTenant', primary: true },
    );
  }

  async targetForTenant(id: string): Promise<WebhookTarget | null> {
    return this.db.queryOne<WebhookTarget>(
      `SELECT id, url, secret FROM partner_webhooks WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
      [id, requireTenantId()],
      { name: 'webhook.targetForTenant', primary: true },
    );
  }

  async revokeForTenant(id: string): Promise<void> {
    await this.db.execute_(
      `UPDATE partner_webhooks SET revoked_at = now(), is_active = false WHERE id = $1 AND tenant_id = $2`,
      [id, requireTenantId()],
      { name: 'webhook.revokeForTenant', primary: true },
    );
  }

  async deliveriesForTenant(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
    return this.db.query<WebhookDelivery>(
      `SELECT ${DELIVERY_COLUMNS} FROM webhook_deliveries d
        WHERE d.webhook_id = $1 AND d.tenant_id = $2 ORDER BY d.created_at DESC LIMIT $3`,
      [webhookId, requireTenantId(), Math.min(limit, 100)],
      { name: 'webhook.deliveriesForTenant', primary: true },
    );
  }

  /* ── GDS partner endpoint (platform admin) ────────────────────────── */

  /**
   * Set a partner's endpoint (one per partner). Replacing it revokes the old
   * one and issues a NEW secret, returned once.
   */
  async setForPartner(input: {
    gdsPartnerId: string;
    name: string;
    url: string;
    eventTypes: string[];
    createdBy: string | null;
  }): Promise<{ id: string; secret: string }> {
    const id = newId();
    const secret = newSecret();
    await this.uow.run({ name: 'webhook.setForPartner', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE partner_webhooks SET revoked_at = now(), is_active = false
          WHERE gds_partner_id = $1 AND revoked_at IS NULL`,
        [input.gdsPartnerId],
      );
      await scope.client.query(
        `INSERT INTO partner_webhooks (id, gds_partner_id, name, url, secret, event_types, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, input.gdsPartnerId, input.name, input.url, secret, input.eventTypes, input.createdBy],
      );
    });
    return { id, secret };
  }

  async getForPartner(gdsPartnerId: string): Promise<WebhookEndpoint | null> {
    return this.uow.run(
      { name: 'webhook.getForPartner', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<WebhookEndpoint>(
          `SELECT ${ENDPOINT_COLUMNS} FROM partner_webhooks WHERE gds_partner_id = $1 AND revoked_at IS NULL`,
          [gdsPartnerId],
        );
        return r.rows[0] ?? null;
      },
    );
  }

  async targetForPartner(gdsPartnerId: string): Promise<WebhookTarget | null> {
    return this.uow.run(
      { name: 'webhook.targetForPartner', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<WebhookTarget>(
          `SELECT id, url, secret FROM partner_webhooks WHERE gds_partner_id = $1 AND revoked_at IS NULL`,
          [gdsPartnerId],
        );
        return r.rows[0] ?? null;
      },
    );
  }

  async removeForPartner(gdsPartnerId: string): Promise<void> {
    await this.uow.run({ name: 'webhook.removeForPartner', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `UPDATE partner_webhooks SET revoked_at = now(), is_active = false
          WHERE gds_partner_id = $1 AND revoked_at IS NULL`,
        [gdsPartnerId],
      );
    });
  }

  async deliveriesForPartner(gdsPartnerId: string, limit = 20): Promise<WebhookDelivery[]> {
    return this.uow.run(
      { name: 'webhook.deliveriesForPartner', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<WebhookDelivery>(
          `SELECT ${DELIVERY_COLUMNS}
           FROM webhook_deliveries d JOIN partner_webhooks w ON w.id = d.webhook_id
          WHERE w.gds_partner_id = $1 ORDER BY d.created_at DESC LIMIT $2`,
          [gdsPartnerId, Math.min(limit, 100)],
        );
        return r.rows;
      },
    );
  }

  /* ── worker side (cross-tenant) ───────────────────────────────────── */

  /** Active endpoints subscribed to this event: the operator's own + the given GDS partners'. */
  async targetsFor(
    tenantId: string,
    gdsPartnerIds: string[],
    eventType: string,
  ): Promise<WebhookTarget[]> {
    return this.uow.run(
      { name: 'webhook.targetsFor', bypassRls: true, readOnly: true },
      async (scope) => {
        const r = await scope.client.query<WebhookTarget>(
          `SELECT id, url, secret FROM partner_webhooks
          WHERE (tenant_id = $1 OR gds_partner_id = ANY($2::uuid[]))
            AND is_active = true AND revoked_at IS NULL
            AND (event_types = '{}' OR $3 = ANY(event_types))`,
          [tenantId, gdsPartnerIds, eventType],
        );
        return r.rows;
      },
    );
  }

  /** Queue a delivery — idempotent per (endpoint, event), so an at-least-once outbox replay never double-sends. */
  async enqueueDelivery(input: {
    webhookId: string;
    tenantId: string;
    eventType: string;
    eventId: string;
    payload: unknown;
  }): Promise<string | null> {
    return this.uow.run({ name: 'webhook.enqueueDelivery', bypassRls: true }, async (scope) => {
      const r = await scope.client.query<{ id: string }>(
        `INSERT INTO webhook_deliveries (id, webhook_id, tenant_id, event_type, event_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (webhook_id, event_id) DO NOTHING
         RETURNING id`,
        [
          newId(),
          input.webhookId,
          input.tenantId,
          input.eventType,
          input.eventId,
          JSON.stringify(input.payload),
        ],
      );
      return r.rows[0]?.id ?? null;
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

  /** Backoff 1 min, 5 min, 30 min, 3 h, then give up ('failed') after 5 attempts. */
  async markFailed(
    deliveryId: string,
    attemptsSoFar: number,
    error: string,
    responseStatus?: number,
  ): Promise<void> {
    const backoffMinutes = nextRetryMinutes(attemptsSoFar);
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
      const r = await scope.client.query<DueDelivery>(
        `SELECT d.id, d.webhook_id AS "webhookId", w.url, w.secret, d.event_type AS "eventType",
                d.event_id AS "eventId", d.payload, d.attempts
           FROM webhook_deliveries d JOIN partner_webhooks w ON w.id = d.webhook_id
          WHERE d.status = 'pending' AND d.next_attempt_at <= now() AND d.attempts < 5
            AND w.revoked_at IS NULL
          ORDER BY d.next_attempt_at LIMIT $1`,
        [Math.min(limit, 200)],
      );
      return r.rows;
    });
  }
}

function newSecret(): string {
  return randomBytes(32).toString('hex');
}
