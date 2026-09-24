import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  requireTenantId,
  runAsTenant,
  type BookingId,
  type CurrencyCode,
  type TenantId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger, Metrics } from '@observability';

import { BookingRepository } from '../../../booking';
import {
  offlineRefundEntry,
  partnerCommissionReversalEntry,
  refundEntry,
  LedgerRepository,
  PaymentGateway,
} from '../../../payment';
import {
  assertRefundTransition,
  initialStatusFor,
  isRefundTerminal,
  type RefundDestination,
  type RefundStatus,
} from '../../domain/refund-state';
import { splitRefundClawback } from '../../domain/refund-clawback';
import { RefundCreditorRegistry } from './refund-creditor.registry';
import { RefundRepository } from '../../infrastructure/persistence/refund.repository';

/**
 * ============================================================================
 *  Refund lifecycle service
 * ============================================================================
 *
 * Drives a refund through its state machine (see refund-state.ts). Two
 * destinations, BOTH of which go through `processing` — neither is instant:
 *
 *  SOURCE            — through the PSP. Call `gateway.refund`, record the
 *                       gateway refund id, and leave the refund `processing`.
 *                       The gateway's async webhook later drives
 *                       `reconcileGatewayEvent` → settled (posting the
 *                       ledger) or failed (retryable, or paid manually).
 *
 *  ALTERNATE_ACCOUNT — the customer supplies a different bank account to
 *                       receive the refund into. No PSP can refund to an
 *                       account it never charged, so this never touches the
 *                       gateway at all — it's recorded `processing` and
 *                       settled by a human actually sending the transfer.
 *
 * Every money move is a balanced ledger entry, so the books always reconcile.
 * The whole flow is idempotent: initiating twice for one booking returns the
 * existing refund; a duplicate webhook for an already-settled refund is a no-op.
 */
@Injectable()
export class RefundService {
  private readonly log: Logger;

  constructor(
    private readonly refunds: RefundRepository,
    private readonly bookings: BookingRepository,
    private readonly ledger: LedgerRepository,
    private readonly gateway: PaymentGateway,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    logger: Logger,
    private readonly metrics: Metrics,
    private readonly creditors: RefundCreditorRegistry,
  ) {
    this.log = logger.forContext('RefundService');
  }

  /**
   * Initiate a refund for a booking. Idempotent — a booking already having a
   * live (non-cancelled) refund returns that one rather than double-refunding.
   *
   * altAccountDetails is REQUIRED when destination is 'alternate_account' —
   * a PSP can only ever refund back to the instrument that originally paid,
   * never to an arbitrary bank account, so this path never touches the
   * gateway at all; it records the account details and stays 'processing'
   * until a human actually sends the transfer and marks it settled/manual.
   */
  async initiate(input: {
    bookingId: BookingId;
    amountMinor: number;
    destination: RefundDestination;
    cancellationId?: string;
    altAccountDetails?: {
      accountHolder: string;
      accountNumber: string;
      ifsc: string;
      bankName?: string;
    };
  }): Promise<{ refundId: string; status: RefundStatus }> {
    if (input.amountMinor <= 0) {
      // A zero-refund cancellation (e.g. non-refundable fare) is a valid no-op.
      return { refundId: '', status: 'cancelled' };
    }
    if (input.destination === 'alternate_account' && !input.altAccountDetails) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Alternate-account refund requires account details',
      });
    }
    if (!Number.isInteger(input.amountMinor)) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Refund amount must be a whole number of paise',
      });
    }
    const tenantId = requireTenantId();
    // Phase 1 — decide + record, in ONE short transaction. No network calls
    // in here: a PSP call inside a transaction that later rolls back would
    // have refunded real money with no record of it.
    const plan = await this.uow.run(
      { name: 'refund.initiate', tenantId },
      async (): Promise<
        | { kind: 'done'; refundId: string; status: RefundStatus }
        | { kind: 'dispatch'; refundId: string }
      > => {
        // Lock the booking FIRST: concurrent refunds for one booking serialise
        // here, so the over-refund check below can never race.
        const booking = await this.bookings.findForUpdate(input.bookingId);
        if (!booking)
          throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

        // Idempotency is per CANCELLATION (a redelivered cancellation event
        // returns its refund). Per-booking idempotency swallowed every partial
        // cancellation after the first.
        if (input.cancellationId) {
          const existing = await this.refunds.findByCancellation(input.cancellationId);
          if (existing) return { kind: 'done', refundId: existing.id, status: existing.status };
        }

        const intent = await this.refunds.capturedIntentForBooking(input.bookingId);
        const capturedMinor = await this.refunds.capturedAmountForBooking(input.bookingId);
        const alreadyMinor = await this.refunds.committedRefundTotal(input.bookingId);
        if (alreadyMinor + input.amountMinor > capturedMinor) {
          throw new AppError(ErrorCode.REFUND_NOT_ALLOWED, 422, {
            message: `Refund of ₹${(input.amountMinor / 100).toFixed(2)} exceeds what remains refundable (₹${(Math.max(0, capturedMinor - alreadyMinor) / 100).toFixed(2)})`,
            details: {
              capturedMinor,
              alreadyRefundedMinor: alreadyMinor,
              requestedMinor: input.amountMinor,
            },
          });
        }

        const currency = booking.currency as CurrencyCode;
        const destination = input.destination;
        const refundId = await this.refunds.create({
          bookingId: input.bookingId,
          paymentIntentId: intent?.id ?? null,
          amountMinor: input.amountMinor,
          currency,
          status: initialStatusFor(destination),
          destination,
          cancellationId: input.cancellationId ?? null,
          altAccountDetails: input.altAccountDetails ?? null,
        });

        // Customer asked for a different account: recorded for ops to transfer
        // manually. Checked first so an explicit choice is never overridden.
        if (destination === 'alternate_account') {
          this.metrics.bookings.inc({
            outcome: 'refund_alternate_account_pending',
            channel: 'direct',
          });
          return { kind: 'done', refundId, status: 'processing' };
        }

        // B2B sale (operator agent / GDS partner): the refund is credited to
        // the seller's account by that channel's registered creditor.
        const creditor = this.creditors.for(intent?.gateway);
        if (creditor) {
          const tenantId = requireTenantId();
          const credited = await creditor.creditRefund({
            bookingId: input.bookingId,
            refundId,
            refundMinor: input.amountMinor,
            tenantId,
          });
          if (!credited) {
            await this.refunds.transition(refundId, 'failed', {
              failureReason: creditor.missingAccountReason,
            });
            return { kind: 'done', refundId, status: 'failed' };
          }
          if (creditor.collectedBy === 'operator') {
            // The operator holds the cash: only the platform's commission share is reversed.
            await this.postOfflineRefundLedger(input.bookingId, input.amountMinor, currency);
          } else {
            // The platform captured it from the partner: reverse the capture and
            // give the partner's commission share back to the operator.
            const rev = partnerCommissionReversalEntry({
              currency,
              bookingId: input.bookingId,
              operatorId: tenantId,
              clawbackMinor: credited.clawbackMinor,
            });
            if (rev) await this.ledger.post(rev);
            await this.postRefundLedger(input.bookingId, input.amountMinor, currency);
          }
          await this.refunds.transition(refundId, 'settled', { reconciled: true });
          await this.publishSettled(
            refundId,
            input.bookingId,
            input.amountMinor,
            currency,
            creditor.destination,
          );
          this.metrics.bookings.inc({
            outcome: `refund_${creditor.destination}`,
            channel: creditor.channel,
          });
          return { kind: 'done', refundId, status: 'settled' };
        }

        // Our own PSP: dispatched AFTER this transaction commits (phase 2).
        if (intent?.gatewayPaymentId && intent.gateway === this.gateway.name)
          return { kind: 'dispatch', refundId };

        // OTA/GDS partner collected the money — only the partner can refund it.
        if (intent?.gateway === 'partner') {
          await this.refunds.transition(refundId, 'processing', {
            failureReason: 'awaiting partner-side refund reconciliation',
          });
          this.metrics.bookings.inc({ outcome: 'refund_partner_pending', channel: 'ota' });
          return { kind: 'done', refundId, status: 'processing' };
        }

        await this.refunds.transition(refundId, 'failed', {
          failureReason: 'no captured payment to refund',
        });
        return { kind: 'done', refundId, status: 'failed' };
      },
    );

    if (plan.kind === 'done') return { refundId: plan.refundId, status: plan.status };
    return this.dispatch(plan.refundId);
  }

  /**
   * Phase 2 + 3 — send a recorded refund to the PSP, OUTSIDE any transaction,
   * then record the outcome. Idempotency key = refund id (+ "-<attempt>" for
   * a deliberate retry): re-sending the same attempt after a crash or timeout
   * can never refund twice. A network failure leaves the refund 'processing'
   * with no gateway id — the sweeper (dispatchPending) re-sends it.
   */
  async dispatch(refundId: string): Promise<{ refundId: string; status: RefundStatus }> {
    const tenantId = requireTenantId();
    const target = await this.uow.run({ name: 'refund.dispatch.load', tenantId }, async () => {
      const r = await this.refunds.findForUpdate(refundId);
      if (!r) throw new AppError(ErrorCode.REFUND_NOT_FOUND, 404, { message: 'Refund not found' });
      if (r.status !== 'processing' || r.gatewayRefundId || r.destination !== 'source')
        return { skip: true as const, status: r.status };
      const intent = await this.refunds.capturedIntentForBooking(r.bookingId);
      if (!intent?.gatewayPaymentId || intent.gateway !== this.gateway.name)
        return { skip: true as const, status: r.status };
      return { skip: false as const, refund: r, gatewayPaymentId: intent.gatewayPaymentId };
    });
    if (target.skip) return { refundId, status: target.status };

    const idempotencyKey =
      target.refund.dispatchAttempt === 0
        ? refundId
        : `${refundId}-${target.refund.dispatchAttempt}`;
    let result: Awaited<ReturnType<PaymentGateway['refund']>>;
    try {
      result = await this.gateway.refund({
        gatewayPaymentId: target.gatewayPaymentId,
        amountMinor: target.refund.amountMinor,
        refundId: idempotencyKey,
      });
    } catch (err) {
      this.log.warn(
        { refundId, err: err instanceof Error ? err.message : String(err) },
        'refund dispatch failed — will be re-sent by the sweeper',
      );
      return { refundId, status: 'processing' };
    }

    return this.uow.run({ name: 'refund.dispatch.record', tenantId }, async () => {
      const r = await this.refunds.findForUpdate(refundId);
      if (!r || r.status !== 'processing') return { refundId, status: r?.status ?? 'processing' };
      if (result.status === 'failed') {
        await this.refunds.transition(refundId, 'failed', {
          gatewayRefundId: result.gatewayRefundId,
          failureReason: 'gateway rejected refund',
        });
        return { refundId, status: 'failed' as RefundStatus };
      }
      if (result.status === 'processed') {
        // The PSP completed it synchronously — settle now (the later webhook
        // becomes a no-op). Before, this waited for a webhook forever in
        // mock/test mode, which never sends one.
        await this.refunds.transition(refundId, 'processing', {
          gatewayRefundId: result.gatewayRefundId,
        });
        await this.settle(r.id, r.bookingId, r.amountMinor, r.currency as CurrencyCode, 'source');
        return { refundId, status: 'settled' as RefundStatus };
      }
      await this.refunds.transition(refundId, 'processing', {
        gatewayRefundId: result.gatewayRefundId,
      });
      this.metrics.bookings.inc({ outcome: 'refund_source', channel: 'direct' });
      return { refundId, status: 'processing' as RefundStatus };
    });
  }

  /** Worker sweep: re-send gateway refunds that were recorded but never confirmed as sent. */
  async dispatchPending(limit = 100): Promise<number> {
    const pending = await this.refunds.pendingDispatch(this.gateway.name, 120, limit);
    let sent = 0;
    for (const p of pending) {
      try {
        await runAsTenant(p.tenantId as TenantId, () => this.dispatch(p.id));
        sent += 1;
      } catch (err) {
        this.log.error(
          { refundId: p.id, err: err instanceof Error ? err.message : String(err) },
          'refund sweep failed for one refund',
        );
      }
    }
    return sent;
  }

  /**
   * Reconcile a gateway refund webhook. `processed` → settled (posts the
   * ledger); `failed` → failed (retryable). Idempotent on a terminal refund.
   */
  async reconcileGatewayEvent(input: {
    gatewayRefundId: string;
    status: 'processed' | 'failed';
    reason?: string;
  }): Promise<void> {
    await this.uow.run({ name: 'refund.reconcile', tenantId: requireTenantId() }, async () => {
      const found = await this.refunds.findByGatewayRefundId(input.gatewayRefundId);
      if (!found) {
        this.log.warn(
          { gatewayRefundId: input.gatewayRefundId },
          'Refund webhook for unknown gateway refund id',
        );
        return;
      }
      const refund = await this.refunds.findForUpdate(found.id);
      if (!refund || isRefundTerminal(refund.status)) return; // already settled/cancelled — no-op

      const to: RefundStatus = input.status === 'processed' ? 'settled' : 'failed';
      assertRefundTransition(refund.status, to);

      if (to === 'settled') {
        await this.settle(
          refund.id,
          refund.bookingId,
          refund.amountMinor,
          refund.currency as CurrencyCode,
          'source',
        );
      } else {
        await this.refunds.transition(refund.id, 'failed', {
          failureReason: input.reason ?? 'gateway reported failure',
        });
      }
    });
  }

  /** Retry a FAILED source refund: new dispatch attempt (fresh PSP idempotency key), then send. */
  async retry(refundId: string): Promise<{ status: RefundStatus }> {
    await this.uow.run({ name: 'refund.retry', tenantId: requireTenantId() }, async () => {
      const refund = await this.refunds.findForUpdate(refundId);
      if (!refund)
        throw new AppError(ErrorCode.REFUND_NOT_FOUND, 404, { message: 'Refund not found' });
      assertRefundTransition(refund.status, 'processing'); // only failed → processing; a double click fails here
      if (refund.destination !== 'source')
        throw new AppError(ErrorCode.REFUND_NOT_ALLOWED, 422, {
          message: 'Only a gateway (source) refund can be retried',
        });
      const intent = await this.refunds.capturedIntentForBooking(refund.bookingId);
      if (!intent?.gatewayPaymentId || intent.gateway !== this.gateway.name) {
        throw new AppError(ErrorCode.REFUND_NOT_ALLOWED, 422, {
          message: 'No captured gateway payment to retry against',
        });
      }
      await this.refunds.beginRetry(refundId);
    });
    const { status } = await this.dispatch(refundId);
    return { status };
  }

  /** Mark a failed refund as paid outside the gateway (manual bank transfer). */
  async markManual(refundId: string): Promise<void> {
    await this.uow.run({ name: 'refund.manual', tenantId: requireTenantId() }, async () => {
      const refund = await this.refunds.findForUpdate(refundId);
      if (!refund)
        throw new AppError(ErrorCode.REFUND_NOT_FOUND, 404, { message: 'Refund not found' });
      assertRefundTransition(refund.status, 'manual');
      // Money left the business outside the gateway; the ledger still records it.
      await this.postRefundLedger(
        refund.bookingId,
        refund.amountMinor,
        refund.currency as CurrencyCode,
      );
      await this.refunds.transition(refundId, 'manual', { reconciled: true });
      const booking = await this.bookings.findForUpdate(refund.bookingId);
      this.events.publish({
        type: 'refund.settled',
        aggregateType: 'refund',
        aggregateId: refundId,
        payload: {
          bookingId: refund.bookingId,
          pnr: booking?.pnr ?? null,
          refundMinor: refund.amountMinor,
          currency: refund.currency,
          destination: 'manual',
          contactPhone: booking?.contactPhone ?? null,
          contactEmail: booking?.contactEmail ?? null,
        },
      });
    });
  }

  async listForBooking(bookingId: BookingId): Promise<unknown[]> {
    return this.refunds.listByBooking(bookingId);
  }

  /** processing → settled: ledger entry, status, notification event. Caller holds the refund row lock. */
  private async settle(
    refundId: string,
    bookingId: BookingId,
    amountMinor: number,
    currency: CurrencyCode,
    destination: string,
  ): Promise<void> {
    await this.postRefundLedger(bookingId, amountMinor, currency);
    await this.refunds.transition(refundId, 'settled', { reconciled: true });
    await this.publishSettled(refundId, bookingId, amountMinor, currency, destination);
  }

  private async publishSettled(
    refundId: string,
    bookingId: BookingId,
    amountMinor: number,
    currency: string,
    destination: string,
  ): Promise<void> {
    const booking = await this.bookings.findForUpdate(bookingId);
    this.events.publish({
      type: 'refund.settled',
      aggregateType: 'refund',
      aggregateId: refundId,
      payload: {
        bookingId,
        pnr: booking?.pnr ?? null,
        refundMinor: amountMinor,
        currency,
        destination,
        contactPhone: booking?.contactPhone ?? null,
        contactEmail: booking?.contactEmail ?? null,
      },
    });
  }

  /** Agent sale refund: the platform only gives back its share of commission (+GST) to the operator. */
  private async postOfflineRefundLedger(
    bookingId: BookingId,
    refundMinor: number,
    currency: CurrencyCode,
  ): Promise<void> {
    const split = await this.refunds.offlineCapturedSplit(bookingId);
    if (split.saleTotalMinor <= 0) return;
    const ratio = Math.min(1, refundMinor / split.saleTotalMinor);
    const entry = offlineRefundEntry({
      currency,
      bookingId,
      operatorId: requireTenantId(),
      commissionClawbackMinor: Math.min(
        split.remainingCommissionMinor,
        Math.round(split.commissionMinor * ratio),
      ),
      commissionGstClawbackMinor: Math.min(
        split.remainingCommissionGstMinor,
        Math.round(split.commissionGstMinor * ratio),
      ),
    });
    if (entry) await this.ledger.post(entry);
  }

  /**
   * Post the balanced `refund.paid` ledger entry, clawing back the operator
   * share, platform commission, AND the commission's own GST in the same
   * proportion they were booked, so a partial refund reverses exactly its
   * share and the books stay at zero.
   */
  private async postRefundLedger(
    bookingId: BookingId,
    refundMinor: number,
    currency: CurrencyCode,
  ): Promise<void> {
    const split = await this.refunds.capturedSplit(bookingId);
    const { commissionClawbackMinor, commissionGstClawbackMinor, operatorClawbackMinor } =
      splitRefundClawback(split, refundMinor);

    await this.ledger.post(
      refundEntry({
        currency,
        bookingId,
        operatorId: requireTenantId(),
        refundMinor,
        operatorClawbackMinor,
        commissionClawbackMinor,
        commissionGstClawbackMinor,
      }),
    );
  }
}
