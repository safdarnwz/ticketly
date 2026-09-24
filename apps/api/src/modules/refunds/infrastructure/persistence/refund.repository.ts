import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService, UnitOfWork } from '@database';
import { newId, requireTenantId, type BookingId, type PaymentId } from '@kernel';

import type { RefundDestination, RefundStatus } from '../../domain/refund-state';

export interface RefundRow {
  id: string;
  bookingId: BookingId;
  paymentIntentId: PaymentId | null;
  amountMinor: number;
  currency: string;
  status: RefundStatus;
  destination: RefundDestination;
  gatewayRefundId: string | null;
  cancellationId: string | null;
  dispatchAttempt: number;
}

/**
 * Refund persistence + the ledger figures a refund needs.
 *
 * All mutating methods run inside the caller's transaction (via
 * `currentTransaction()`), so a refund's status change commits atomically with
 * the ledger posting / wallet credit that accompanies it — never half-applied.
 */
@Injectable()
export class RefundRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  /** The captured intent for a booking (source of the gateway refund). */
  async capturedIntentForBooking(
    bookingId: BookingId,
  ): Promise<{ id: PaymentId; gateway: string; gatewayPaymentId: string | null } | null> {
    return this.db.queryOne(
      `SELECT id, gateway, gateway_payment_id AS "gatewayPaymentId"
         FROM payment_intents WHERE tenant_id = $1 AND booking_id = $2 AND status = 'captured'
        ORDER BY captured_at DESC LIMIT 1`,
      [requireTenantId(), bookingId],
      { name: 'refund.capturedIntent', primary: true },
    );
  }

  /**
   * The captured commission/operator split for a booking, read from the ledger
   * (the source of truth) so a refund claws back exactly what was booked.
   */
  async capturedSplit(
    bookingId: BookingId,
  ): Promise<{ commissionMinor: number; commissionGstMinor: number; operatorShareMinor: number }> {
    const row = await this.db.queryOne<{
      commission: number;
      commission_gst: number;
      operator: number;
    }>(
      `SELECT
         coalesce(sum(CASE WHEN lp.account = 'platform_revenue' THEN -lp.amount_minor ELSE 0 END), 0)::bigint AS commission,
         coalesce(sum(CASE WHEN lp.account = 'commission_tax_payable' THEN -lp.amount_minor ELSE 0 END), 0)::bigint AS commission_gst,
         coalesce(sum(CASE WHEN lp.account = 'operator_payable' THEN -lp.amount_minor ELSE 0 END), 0)::bigint AS operator
       FROM ledger_postings lp
       JOIN ledger_entries le ON le.id = lp.entry_id
      WHERE lp.tenant_id = $1 AND le.source_type = 'booking' AND le.source_id = $2 AND le.entry_type = 'booking.captured'`,
      [requireTenantId(), bookingId],
      { name: 'refund.capturedSplit', primary: true },
    );
    return {
      commissionMinor: Number(row?.commission ?? 0),
      commissionGstMinor: Number(row?.commission_gst ?? 0),
      operatorShareMinor: Number(row?.operator ?? 0),
    };
  }

  /**
   * Split for an OFFLINE-captured (B2B agent) booking: the platform's
   * original commission + commission GST, what is still un-reversed after
   * earlier partial refunds, and the original sale value (the 'agent'
   * payment intent) — the proportion base must be the ORIGINAL sale, never
   * booking.paidMinor, which a partial cancellation has already reduced.
   */
  async offlineCapturedSplit(bookingId: BookingId): Promise<{
    commissionMinor: number;
    commissionGstMinor: number;
    remainingCommissionMinor: number;
    remainingCommissionGstMinor: number;
    saleTotalMinor: number;
  }> {
    const row = await this.db.queryOne<{
      c: string;
      g: string;
      rc: string;
      rg: string;
      sale: string;
    }>(
      `SELECT
         coalesce(sum(CASE WHEN le.entry_type = 'booking.captured_offline' AND lp.account = 'platform_revenue' THEN -lp.amount_minor ELSE 0 END), 0) AS c,
         coalesce(sum(CASE WHEN le.entry_type = 'booking.captured_offline' AND lp.account = 'commission_tax_payable' THEN -lp.amount_minor ELSE 0 END), 0) AS g,
         coalesce(sum(CASE WHEN lp.account = 'platform_revenue' THEN -lp.amount_minor ELSE 0 END), 0) AS rc,
         coalesce(sum(CASE WHEN lp.account = 'commission_tax_payable' THEN -lp.amount_minor ELSE 0 END), 0) AS rg,
         (SELECT coalesce(max(amount_minor), 0) FROM payment_intents
           WHERE tenant_id = $1 AND booking_id = $2 AND gateway = 'agent') AS sale
       FROM ledger_postings lp
       JOIN ledger_entries le ON le.id = lp.entry_id
      WHERE lp.tenant_id = $1 AND le.source_type = 'booking' AND le.source_id = $2
        AND le.entry_type IN ('booking.captured_offline', 'refund.offline')`,
      [requireTenantId(), bookingId],
      { name: 'refund.offlineCapturedSplit', primary: true },
    );
    return {
      commissionMinor: Number(row?.c ?? 0),
      commissionGstMinor: Number(row?.g ?? 0),
      remainingCommissionMinor: Math.max(0, Number(row?.rc ?? 0)),
      remainingCommissionGstMinor: Math.max(0, Number(row?.rg ?? 0)),
      saleTotalMinor: Number(row?.sale ?? 0),
    };
  }

  /**
   * "Active" here means "don't start a second, competing refund attempt" —
   * NOT "this booking's refund story is closed". 'failed' is deliberately
   * excluded: a failed refund must be RETRIABLE (the failure might be a
   * transient gateway error, or — as it genuinely was before this fix —
   * the destination-routing bug that made every customer-wallet refund
   * fail outright). Treating 'failed' as active would let a single bad
   * attempt PERMANENTLY block every future retry for that booking, even
   * after the underlying cause is fixed.
   */
  /** Total actually captured for the booking (any gateway, incl. partner/agent intents). */
  async capturedAmountForBooking(bookingId: BookingId): Promise<number> {
    const row = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(sum(amount_minor), 0) AS total FROM payment_intents
        WHERE tenant_id = $1 AND booking_id = $2 AND status IN ('captured', 'refunded')`,
      [requireTenantId(), bookingId],
      { name: 'refund.capturedAmount', primary: true },
    );
    return Number(row?.total ?? 0);
  }

  /** The refund already raised for THIS cancellation (idempotency for event redelivery). */
  async findByCancellation(cancellationId: string): Promise<RefundRow | null> {
    const row = await this.db.queryOne<Raw>(
      `${SELECT} WHERE tenant_id = $1 AND cancellation_id = $2 AND status IN ('initiated','processing','settled','manual') ORDER BY created_at DESC LIMIT 1`,
      [requireTenantId(), cancellationId],
      { name: 'refund.findByCancellation', primary: true },
    );
    return row ? map(row) : null;
  }

  /** Everything already refunded or in flight for a booking (failed/cancelled attempts excluded). */
  async committedRefundTotal(bookingId: BookingId): Promise<number> {
    const row = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(sum(amount_minor), 0) AS total FROM refunds
        WHERE tenant_id = $1 AND booking_id = $2 AND status IN ('initiated','processing','settled','manual')`,
      [requireTenantId(), bookingId],
      { name: 'refund.committedTotal', primary: true },
    );
    return Number(row?.total ?? 0);
  }

  async findActiveByBooking(bookingId: BookingId): Promise<RefundRow | null> {
    const row = await this.db.queryOne<Raw>(
      `${SELECT} WHERE tenant_id = $1 AND booking_id = $2 AND status IN ('initiated','processing','settled','manual') ORDER BY created_at DESC LIMIT 1`,
      [requireTenantId(), bookingId],
      { name: 'refund.findActive', primary: true },
    );
    return row ? map(row) : null;
  }

  async findForUpdate(refundId: string): Promise<RefundRow | null> {
    const scope = currentTransaction();
    if (!scope) throw new Error('refund.findForUpdate must run inside a transaction');
    const res = await scope.client.query<Raw>(
      `${SELECT} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), refundId],
    );
    return res.rows[0] ? map(res.rows[0]) : null;
  }

  async create(input: {
    bookingId: BookingId;
    paymentIntentId: PaymentId | null;
    amountMinor: number;
    currency: string;
    status: RefundStatus;
    destination: RefundDestination;
    cancellationId: string | null;
    altAccountDetails?: {
      accountHolder: string;
      accountNumber: string;
      ifsc: string;
      bankName?: string;
    } | null;
  }): Promise<string> {
    const scope = currentTransaction();
    const id = newId();
    const sql = `INSERT INTO refunds (id, tenant_id, booking_id, payment_intent_id, amount_minor, currency, status, destination, cancellation_id,
                                       alt_account_holder, alt_account_number, alt_ifsc, alt_bank_name)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;
    const params = [
      id,
      requireTenantId(),
      input.bookingId,
      input.paymentIntentId,
      input.amountMinor,
      input.currency,
      input.status,
      input.destination,
      input.cancellationId,
      input.altAccountDetails?.accountHolder ?? null,
      input.altAccountDetails?.accountNumber ?? null,
      input.altAccountDetails?.ifsc ?? null,
      input.altAccountDetails?.bankName ?? null,
    ];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'refund.create', primary: true });
    return id;
  }

  /** Move a refund to a new status, optionally recording gateway/reconcile fields. */
  /** A deliberate retry of a FAILED refund: back to processing, with a new dispatch attempt (→ new PSP idempotency key). */
  async beginRetry(refundId: string): Promise<void> {
    const scope = currentTransaction();
    if (!scope) throw new Error('beginRetry requires a transaction');
    await scope.client.query(
      `UPDATE refunds SET status = 'processing', gateway_refund_id = NULL, failure_reason = NULL,
              dispatch_attempt = dispatch_attempt + 1, updated_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), refundId],
    );
  }

  /**
   * Gateway refunds recorded but never confirmed as sent (crash / timeout
   * between our commit and the PSP call). Cross-tenant, RLS bypassed —
   * returns ids + tenant only; the sweeper re-dispatches each as its tenant.
   */
  async pendingDispatch(
    gateway: string,
    olderThanSeconds: number,
    limit: number,
  ): Promise<{ id: string; tenantId: string }[]> {
    return this.uow.run({ name: 'refund.pendingDispatch', bypassRls: true }, async (scope) =>
      (
        await scope.client.query<{ id: string; tenant_id: string }>(
          `SELECT r.id, r.tenant_id FROM refunds r
           JOIN payment_intents p ON p.id = r.payment_intent_id
          WHERE r.status = 'processing' AND r.gateway_refund_id IS NULL AND r.destination = 'source'
            AND p.gateway = $1 AND r.updated_at < now() - make_interval(secs => $2)
          ORDER BY r.updated_at LIMIT $3`,
          [gateway, olderThanSeconds, limit],
        )
      ).rows.map((r) => ({ id: r.id, tenantId: r.tenant_id })),
    );
  }

  async transition(
    refundId: string,
    to: RefundStatus,
    patch: { gatewayRefundId?: string; failureReason?: string; reconciled?: boolean } = {},
  ): Promise<void> {
    const scope = currentTransaction();
    const sql = `UPDATE refunds SET status = $3,
                   gateway_refund_id = coalesce($4, gateway_refund_id),
                   failure_reason = $5,
                   reconciled_at = CASE WHEN $6 THEN now() ELSE reconciled_at END,
                   updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`;
    const params = [
      requireTenantId(),
      refundId,
      to,
      patch.gatewayRefundId ?? null,
      patch.failureReason ?? null,
      patch.reconciled ?? false,
    ];
    if (scope) await scope.client.query(sql, params);
    else await this.db.execute_(sql, params, { name: 'refund.transition', primary: true });
  }

  async findByGatewayRefundId(gatewayRefundId: string): Promise<RefundRow | null> {
    const row = await this.db.queryOne<Raw>(
      `${SELECT} WHERE gateway_refund_id = $1 LIMIT 1`,
      [gatewayRefundId],
      { name: 'refund.byGatewayId', primary: true },
    );
    return row ? map(row) : null;
  }

  async listByBooking(bookingId: BookingId): Promise<RefundRow[]> {
    const rows = await this.db.query<Raw>(
      `${SELECT} WHERE tenant_id = $1 AND booking_id = $2 ORDER BY created_at`,
      [requireTenantId(), bookingId],
      { name: 'refund.listByBooking' },
    );
    return rows.map(map);
  }
}

const SELECT = `SELECT id, booking_id AS "bookingId", payment_intent_id AS "paymentIntentId", amount_minor AS "amountMinor",
                       currency, status, destination, gateway_refund_id AS "gatewayRefundId", cancellation_id AS "cancellationId",
                       dispatch_attempt AS "dispatchAttempt"
                  FROM refunds`;

interface Raw {
  id: string;
  bookingId: BookingId;
  paymentIntentId: PaymentId | null;
  amountMinor: number | string;
  currency: string;
  status: RefundStatus;
  destination: RefundDestination;
  gatewayRefundId: string | null;
  cancellationId: string | null;
  dispatchAttempt: number;
}
function map(r: Raw): RefundRow {
  return {
    ...r,
    amountMinor: Number(r.amountMinor),
    dispatchAttempt: Number(r.dispatchAttempt ?? 0),
  };
}
