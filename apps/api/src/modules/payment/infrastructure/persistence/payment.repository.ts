import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService, UnitOfWork } from '@database';
import { newId, requireTenantId, type BookingId, type PaymentId } from '@kernel';

import { PlatformSettingsRepository } from '../../../platform-settings';

export interface PaymentIntent {
  id: PaymentId;
  bookingId: BookingId;
  gateway: string;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  amountMinor: number;
  currency: string;
  status: string;
  /** Only populated by findByOrderId's cross-tenant webhook lookup — every other query already runs inside an ambient tenant context and doesn't need this. */
  tenantId?: string;
  /** Arbitrary per-intent context (e.g. a seat-upgrade's ticketId/toSeatNumber) that a webhook needs to know WHAT this specific capture is actually for, since a payment_intents row is otherwise generic. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaymentRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
    private readonly platformSettings: PlatformSettingsRepository,
  ) {}

  /**
   * Idempotent per purpose: a pending intent for the same booking, amount,
   * currency and metadata is reused (a retried "pay" never creates a second
   * order). A pending intent for anything else — the total changed because an
   * add-on was attached, or it was for a different upgrade — is retired
   * ('failed', superseded) and a new one created, so a customer is never asked
   * to pay a stale amount.
   */
  async createIntent(input: {
    bookingId: BookingId;
    gateway: string;
    amountMinor: number;
    currency: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentIntent> {
    const metadata = JSON.stringify(input.metadata ?? {});
    const existing = await this.db.queryOne<Row>(
      `SELECT id, booking_id, gateway, gateway_order_id, gateway_payment_id, amount_minor, currency, status, metadata
         FROM payment_intents
        WHERE tenant_id = $1 AND booking_id = $2 AND status IN ('created','authorized')
          AND gateway = $3 AND amount_minor = $4 AND currency = $5 AND metadata = $6::jsonb
        ORDER BY created_at DESC LIMIT 1`,
      [
        requireTenantId(),
        input.bookingId,
        input.gateway,
        input.amountMinor,
        input.currency,
        metadata,
      ],
      { name: 'payment.existingIntent', primary: true },
    );
    if (existing) return map(existing);

    await this.db.execute_(
      `UPDATE payment_intents SET status = 'failed', failed_reason = 'superseded', updated_at = now()
        WHERE tenant_id = $1 AND booking_id = $2 AND status = 'created'
          AND coalesce(metadata->>'kind', '') = coalesce($3::jsonb->>'kind', '')`,
      [requireTenantId(), input.bookingId, metadata],
      { name: 'payment.supersedeIntents', primary: true },
    );

    const id = newId() as PaymentId;
    await this.db.execute_(
      `INSERT INTO payment_intents (id, tenant_id, booking_id, gateway, amount_minor, currency, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        requireTenantId(),
        input.bookingId,
        input.gateway,
        input.amountMinor,
        input.currency,
        metadata,
      ],
      { name: 'payment.createIntent', primary: true },
    );
    return {
      id,
      bookingId: input.bookingId,
      gateway: input.gateway,
      gatewayOrderId: null,
      gatewayPaymentId: null,
      amountMinor: input.amountMinor,
      currency: input.currency,
      status: 'created',
      metadata: input.metadata ?? {},
    };
  }

  async findById(id: PaymentId): Promise<PaymentIntent | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT id, booking_id, gateway, gateway_order_id, gateway_payment_id, amount_minor, currency, status, metadata
         FROM payment_intents WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'payment.findById', primary: true },
    );
    return row ? map(row) : null;
  }

  async setGatewayOrder(id: PaymentId, gatewayOrderId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE payment_intents SET gateway_order_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, gatewayOrderId],
      { name: 'payment.setOrder', primary: true },
    );
  }

  async findByOrderId(gateway: string, orderId: string): Promise<PaymentIntent | null> {
    // CRITICAL: this is the ONLY entry point into a webhook's processing —
    // there is NO ambient tenant context for a global PSP webhook (unlike
    // every other call in this codebase, which runs under a request already
    // bound to a tenant via subdomain). payment_intents has RLS applied
    // (migration 0008); without bypassing it here, `tenant_id = current
    // ambient setting` compares against nothing and this ALWAYS returns
    // null — every single webhook would silently fail to find its payment,
    // permanently, for every tenant, with no error to signal it (just a
    // quiet "webhook for unknown order" log line forever). bypassRls is the
    // only way this lookup can work at all; the returned tenantId is what
    // the caller uses to bind a REAL tenant context for everything after.
    const row = await this.uow.run(
      { name: 'payment.findByOrderId', bypassRls: true },
      async (scope) =>
        (
          await scope.client.query<RowWithTenant>(
            `SELECT id, tenant_id, booking_id, gateway, gateway_order_id, gateway_payment_id, amount_minor, currency, status, metadata
           FROM payment_intents WHERE gateway = $1 AND gateway_order_id = $2`,
            [gateway, orderId],
          )
        ).rows[0],
    );
    return row ? mapWithTenant(row) : null;
  }

  /** Cross-tenant lookup by the PSP payment id (refund webhooks carry no order id). RLS bypassed — see findByOrderId. */
  async findByGatewayPaymentId(
    gateway: string,
    gatewayPaymentId: string,
  ): Promise<PaymentIntent | null> {
    if (!gatewayPaymentId) return null;
    const row = await this.uow.run(
      { name: 'payment.findByGatewayPaymentId', bypassRls: true },
      async (scope) =>
        (
          await scope.client.query<RowWithTenant>(
            `SELECT id, tenant_id, booking_id, gateway, gateway_order_id, gateway_payment_id, amount_minor, currency, status, metadata
           FROM payment_intents WHERE gateway = $1 AND gateway_payment_id = $2
           ORDER BY created_at DESC LIMIT 1`,
            [gateway, gatewayPaymentId],
          )
        ).rows[0],
    );
    return row ? mapWithTenant(row) : null;
  }

  /** Processing finished — the dedupe row now also records WHEN it was handled. */
  async markWebhookProcessed(gateway: string, eventId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE webhook_events SET processed_at = now() WHERE gateway = $1 AND event_id = $2`,
      [gateway, eventId],
      { name: 'payment.webhookProcessed', primary: true },
    );
  }

  /**
   * Processing failed for a TRANSIENT reason: forget the dedupe row so the
   * PSP's automatic retry is processed instead of being ignored as a duplicate.
   */
  async forgetWebhook(gateway: string, eventId: string): Promise<void> {
    await this.db.execute_(
      `DELETE FROM webhook_events WHERE gateway = $1 AND event_id = $2 AND processed_at IS NULL`,
      [gateway, eventId],
      { name: 'payment.webhookForget', primary: true },
    );
  }

  /** Existing intent for a booking on a given gateway (e.g. 'partner' for OTA/GDS confirmations) — never mint a second one on a retried call, which would defeat lockIntentForCapture's per-intent exactly-once guard. */
  async findByBookingAndGateway(
    bookingId: BookingId,
    gateway: string,
  ): Promise<PaymentIntent | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT id, booking_id, gateway, gateway_order_id, gateway_payment_id, amount_minor, currency, status
         FROM payment_intents WHERE tenant_id = $1 AND booking_id = $2 AND gateway = $3
         ORDER BY created_at DESC LIMIT 1`,
      [requireTenantId(), bookingId, gateway],
      { name: 'payment.findByBookingAndGateway', primary: true },
    );
    return row ? map(row) : null;
  }

  /** Mark captured inside the current transaction (part of the confirm flow). */
  /**
   * Lock the intent row for the duration of the caller's transaction — this
   * IS the exactly-once guarantee for capture. `onCaptured` (PaymentService)
   * can be invoked twice for the same real payment by design (the webhook
   * AND the client-side verify both call it, deliberately — "defence in
   * depth" so the UI doesn't have to wait for the async webhook). Without
   * this lock-and-check, both calls would each post a FULL ledger entry —
   * doubling the operator's payable and the platform's commission for one
   * real payment. Must be called from inside a transaction (an unlocked read
   * here would let both callers race past the check).
   */
  async lockIntentForCapture(
    id: PaymentId,
  ): Promise<{ status: string; gatewayPaymentId: string | null; gateway: string } | null> {
    const scope = currentTransaction();
    if (!scope) throw new Error('lockIntentForCapture must run inside a transaction');
    const result = await scope.client.query<{
      status: string;
      gateway_payment_id: string | null;
      gateway: string;
    }>(
      `SELECT status, gateway_payment_id, gateway FROM payment_intents WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), id],
    );
    const r = result.rows[0];
    return r
      ? { status: r.status, gatewayPaymentId: r.gateway_payment_id, gateway: r.gateway }
      : null;
  }

  /** Record an extra capture for an already-paid intent. false = already recorded (redelivery). */
  async recordDuplicate(i: {
    intentId: string;
    bookingId: string;
    gateway: string;
    gatewayPaymentId: string;
    amountMinor: number;
  }): Promise<boolean> {
    const n = await this.db.execute_(
      `INSERT INTO duplicate_payments (tenant_id, intent_id, booking_id, gateway, gateway_payment_id, amount_minor) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (gateway, gateway_payment_id) DO NOTHING`,
      [requireTenantId(), i.intentId, i.bookingId, i.gateway, i.gatewayPaymentId, i.amountMinor],
      { name: 'payment.recordDuplicate' },
    );
    return n > 0;
  }

  async duplicateOutcome(
    gateway: string,
    gatewayPaymentId: string,
    outcome: {
      status: 'refunded' | 'refund_failed';
      gatewayRefundId?: string | null;
      reason?: string | null;
    },
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE duplicate_payments SET status = $3, gateway_refund_id = coalesce($4, gateway_refund_id), failure_reason = $5, updated_at = now()
        WHERE gateway = $1 AND gateway_payment_id = $2 AND status <> 'refunded'`,
      [
        gateway,
        gatewayPaymentId,
        outcome.status,
        outcome.gatewayRefundId ?? null,
        outcome.reason ?? null,
      ],
      { name: 'payment.duplicateOutcome', primary: true },
    );
  }

  /** Duplicate refunds not yet completed (crash / PSP error) — re-sent by the sweeper with the same idempotency key. */
  /** Cross-tenant (RLS bypassed): ids + amounts only; each refund is then sent inside its operator's tenant. */
  pendingDuplicates(limit = 100) {
    return this.uow.run(
      { name: 'payment.pendingDuplicates', bypassRls: true },
      async (scope) =>
        (
          await scope.client.query<{
            tenant_id: string;
            gateway: string;
            gateway_payment_id: string;
            booking_id: string;
            amount_minor: string;
          }>(
            `SELECT tenant_id, gateway, gateway_payment_id, booking_id, amount_minor FROM duplicate_payments
        WHERE status = 'refund_pending' AND updated_at < now() - interval '2 minutes' ORDER BY created_at LIMIT $1`,
            [limit],
          )
        ).rows,
    );
  }

  async markCaptured(id: PaymentId, gatewayPaymentId: string): Promise<void> {
    const scope = currentTransaction();
    const sql = `UPDATE payment_intents SET status = 'captured', gateway_payment_id = $3, captured_at = now(), updated_at = now()
                  WHERE tenant_id = $1 AND id = $2`;
    const params = [requireTenantId(), id, gatewayPaymentId];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'payment.markCaptured', primary: true });
  }

  /**
   * Record the chosen payment method + a MASKED instrument reference on the
   * intent's audit metadata, and set the gateway order/payment ids so the
   * captured row looks exactly like a real gateway capture. Full card numbers
   * are NEVER stored — only the masked form produced by the domain.
   */
  async setMethodMetadata(
    id: PaymentId,
    input: {
      method: string;
      masked: string;
      label: string;
      gatewayOrderId: string;
      gatewayPaymentId: string;
    },
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE payment_intents
          SET gateway_order_id = COALESCE(gateway_order_id, $3),
              metadata = metadata || $4::jsonb,
              updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [
        requireTenantId(),
        id,
        input.gatewayOrderId,
        JSON.stringify({
          method: input.method,
          instrument: input.masked,
          instrumentLabel: input.label,
          gatewayPaymentId: input.gatewayPaymentId,
          testMode: true,
        }),
      ],
      { name: 'payment.setMethodMetadata', primary: true },
    );
  }

  async markFailed(id: PaymentId, reason: string): Promise<void> {
    await this.db.execute_(
      // Never downgrade: a late 'failed' event for an EARLIER attempt on the
      // same order must not overwrite a payment that has since been captured
      // (or refunded) — refunds look up the captured intent.
      `UPDATE payment_intents SET status = 'failed', failed_reason = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status IN ('created', 'authorized')`,
      [requireTenantId(), id, reason],
      { name: 'payment.markFailed', primary: true },
    );
  }

  /** Commission config for a route (route-specific, else operator default). */
  /**
   * The platform's take-rate for THIS operator. `operator_commission` is a
   * per-tenant NEGOTIATED override — only the super admin can write it (see
   * TenantAdminController.setCommission — this used to be settable by the
   * operator on THEMSELVES, which let an operator zero out what they owed the
   * platform). No override → falls back to the platform-wide default, not a
   * hard-coded number, so a super admin changing the default actually takes
   * effect for every operator without one.
   */
  async loadCommissionConfig(
    routeId: string,
  ): Promise<{ model: string; percent: number; flatMinor: number; capMinor?: number }> {
    const row = await this.db.queryOne<{
      model: string;
      percent: number;
      flatMinor: number;
      capMinor: number | null;
    }>(
      `SELECT model, percent, flat_minor AS "flatMinor", cap_minor AS "capMinor"
         FROM operator_commission WHERE tenant_id = $1 AND (route_id = $2 OR route_id IS NULL)
        ORDER BY route_id NULLS LAST LIMIT 1`,
      [requireTenantId(), routeId],
      { name: 'payment.commissionConfig', primary: true },
    );
    if (!row)
      return {
        model: 'percent',
        percent: await this.platformSettings.defaultCommissionPercent(),
        flatMinor: 0,
      };
    return {
      model: row.model,
      percent: Number(row.percent ?? 0),
      flatMinor: Number(row.flatMinor ?? 0),
      capMinor: row.capMinor ? Number(row.capMinor) : undefined,
    };
  }

  /**
   * Record a webhook exactly once. Returns false if we've already seen this
   * event id (at-least-once delivery → exactly-once effect).
   */
  async recordWebhookOnce(
    gateway: string,
    eventId: string,
    eventType: string,
    payload: unknown,
  ): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO webhook_events (id, gateway, event_id, event_type, payload)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (gateway, event_id) DO NOTHING
       RETURNING id`,
      [newId(), gateway, eventId, eventType, JSON.stringify(payload)],
      { name: 'payment.recordWebhook', primary: true },
    );
    return row !== null;
  }

  /**
   * PLATFORM-ADMIN writes ONLY (see PaymentController — no tenant self-service
   * path exists for this anymore). `bypassRls` because the caller is a
   * genuinely tenant-less super-admin principal setting a rate ON another
   * tenant, not that tenant acting on itself.
   */
  async setCommissionForTenant(
    tenantId: string,
    input: {
      routeId?: string;
      model: string;
      percent?: number;
      flatMinor?: number;
      capMinor?: number;
    },
  ): Promise<void> {
    await this.uow.run({ name: 'payment.admin.setCommission', bypassRls: true }, async (scope) => {
      await scope.client.query(
        `INSERT INTO operator_commission (id, tenant_id, route_id, model, percent, flat_minor, cap_minor)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, route_id) DO UPDATE SET model=EXCLUDED.model, percent=EXCLUDED.percent,
           flat_minor=EXCLUDED.flat_minor, cap_minor=EXCLUDED.cap_minor, updated_at=now()`,
        [
          newId(),
          tenantId,
          input.routeId ?? null,
          input.model,
          input.percent ?? 0,
          input.flatMinor ?? 0,
          input.capMinor ?? null,
        ],
      );
    });
  }

  async getCommissionForTenant(tenantId: string): Promise<{
    model: string;
    percent: number;
    flatMinor: number;
    capMinor: number | null;
  } | null> {
    return this.uow.run({ name: 'payment.admin.getCommission', bypassRls: true }, async (scope) => {
      const result = await scope.client.query<{
        model: string;
        percent: number;
        flat_minor: number;
        cap_minor: number | null;
      }>(
        `SELECT model, percent, flat_minor, cap_minor FROM operator_commission
          WHERE tenant_id = $1 AND route_id IS NULL LIMIT 1`,
        [tenantId],
      );
      const row = result.rows[0];
      return row
        ? {
            model: row.model,
            percent: Number(row.percent),
            flatMinor: Number(row.flat_minor),
            capMinor: row.cap_minor,
          }
        : null;
    });
  }
}

interface Row {
  id: PaymentId;
  booking_id: BookingId;
  gateway: string;
  gateway_order_id: string | null;
  gateway_payment_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  metadata?: Record<string, unknown>;
}
function map(r: Row): PaymentIntent {
  return {
    id: r.id,
    bookingId: r.booking_id,
    gateway: r.gateway,
    gatewayOrderId: r.gateway_order_id,
    gatewayPaymentId: r.gateway_payment_id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status,
    metadata: r.metadata,
  };
}
interface RowWithTenant extends Row {
  tenant_id: string;
}
function mapWithTenant(r: RowWithTenant): PaymentIntent {
  return { ...map(r), tenantId: r.tenant_id };
}
