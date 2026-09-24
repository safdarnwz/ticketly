import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  newId,
  requireTenantId,
  runAsTenant,
  runInNewContext,
  type BookingId,
  type PaymentId,
  type TenantId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger, Metrics } from '@observability';

import { BookingService } from '../../../booking/application/services/booking.service';
import { BookingRepository } from '../../../booking/infrastructure/persistence/booking.repository';
import { PlatformSettingsRepository } from '../../../platform-settings';
import { SeatUpgradeRepository } from '../../../booking/infrastructure/persistence/seat-upgrade.repository';
import { TripRepository } from '../../../scheduling/infrastructure/persistence/trip.repository';
import { FareRepository } from '../../../pricing/infrastructure/persistence/fare.repository';
import { RouteRepository } from '../../../master-data/infrastructure/persistence/route.repository';
import { captureEntry, offlineCaptureEntry, partnerCommissionEntry } from '../../domain/ledger';
import { classifyCapture } from '../../domain/duplicate-capture';
import { computeCommission, type CommissionConfig } from '../../domain/commission';
import { LedgerRepository } from '../../infrastructure/persistence/ledger.repository';
import {
  PaymentRepository,
  type PaymentIntent,
} from '../../infrastructure/persistence/payment.repository';
import { PaymentGateway } from '../../infrastructure/gateways/gateway.interface';
import {
  validateTestInstrument,
  type TestInstrument,
  type TestGatewayConfig,
} from '../../domain/test-gateway';
import {
  webhookDedupeKey,
  type WebhookVerification,
} from '../../infrastructure/gateways/gateway.interface';

/**
 * Payment orchestration.
 *
 *  1. **createIntent** — idempotently create our intent + a PSP order.
 *  2. **handleWebhook** — the trusted path. Verify the PSP signature over the
 *     RAW body, dedupe the event (exactly-once), and on `captured`:
 *       - confirm the booking (Part 7 seat commit + tickets),
 *       - post the double-entry ledger capture (operator payable + commission +
 *         tax), all in ONE transaction.
 *     A payment we did not initiate, or whose signature fails, is rejected — we
 *     NEVER confirm a booking on an unsigned "success".
 *
 * The webhook is the source of truth for money, not the client callback: a
 * client can lie, the signed server-to-server webhook cannot.
 */
@Injectable()
export class PaymentService {
  private readonly log: Logger;

  constructor(
    private readonly payments: PaymentRepository,
    private readonly ledger: LedgerRepository,
    private readonly bookings: BookingRepository,
    private readonly bookingService: BookingService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly config: AppConfig,
    private readonly gateway: PaymentGateway,
    private readonly platformSettings: PlatformSettingsRepository,
    private readonly seatUpgrades: SeatUpgradeRepository,
    private readonly trips: TripRepository,
    private readonly fares: FareRepository,
    private readonly routes: RouteRepository,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('PaymentService');
  }

  async createIntent(
    bookingId: BookingId,
  ): Promise<{ intentId: PaymentId; clientPayload: Record<string, unknown> }> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    if (booking.status !== 'held') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Only a held booking can be paid for',
      });
    }
    // Checked here too, not just at chargeTest()'s own equivalent check —
    // this is the REAL-gateway entry point. A customer can spend several
    // minutes on the Razorpay checkout screen (card entry, bank OTP);
    // Razorpay has no idea our internal hold has a clock on it, so without
    // this, their hold could expire, a DIFFERENT customer re-lock the same
    // seat, and this customer still complete a real charge for a seat
    // that's no longer reserved for them.
    if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Your seat hold has expired — please search again',
        details: { retryable: false },
      });
    }

    const intent = await this.payments.createIntent({
      bookingId,
      gateway: this.gateway.name,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
    });

    const created = await this.gateway.createIntent({
      intentId: intent.id,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
      bookingId,
      callbackUrl: `${this.config.app.publicBaseUrl}/api/v1/payments/webhook/${this.gateway.name}`,
    });
    await this.payments.setGatewayOrder(intent.id, created.gatewayOrderId);

    return { intentId: intent.id, clientPayload: created.clientPayload };
  }

  /**
   * TEST / SANDBOX charge. TEMPORARY — active only while `PAYMENT_TEST_MODE` is
   * on and no real PSP is wired. The customer picks a method (UPI / card /
   * net-banking) and submits the configured TEST credentials; we validate them
   * with the pure domain validator and, on success, run the exact same capture
   * path a real signed webhook would (confirm booking + post ledger). So a test
   * payment produces real booking + real ledger entries — indistinguishable
   * from a live capture except that the intent is tagged `testMode`.
   *
   * On an invalid instrument we mark the intent failed and return a
   * gateway-style decline (402), so negative testing works too.
   */
  async chargeTest(
    bookingId: BookingId,
    instrument: TestInstrument,
  ): Promise<{
    status: 'captured';
    pnr: string;
    amountMinor: number;
    currency: string;
    method: string;
    instrument: string;
    label: string;
  }> {
    if (!this.config.payment.testMode) {
      throw new AppError(ErrorCode.PAYMENT_GATEWAY_ERROR, 400, {
        message: 'Test payments are disabled',
      });
    }

    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    if (booking.status !== 'held') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Only a held booking can be paid for',
      });
    }
    if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Your seat hold has expired — please search again',
        details: { retryable: false },
      });
    }

    const intent = await this.payments.createIntent({
      bookingId,
      gateway: this.gateway.name,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
    });

    // Validate the submitted test credential (pure). `now` injected for expiry.
    const d = new Date();
    const now = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
    const result = validateTestInstrument(instrument, this.testConfig(), now);
    if (!result.ok) {
      await this.payments.markFailed(intent.id, result.reason);
      this.metrics.bookings.inc({ outcome: 'payment_failed', channel: 'direct' });
      throw new AppError(ErrorCode.PAYMENT_DECLINED, 402, { message: result.reason });
    }

    const gatewayOrderId = `test_order_${intent.id}`;
    const gatewayPaymentId = `test_pay_${newId().replace(/-/g, '').slice(0, 20)}`;
    await this.payments.setMethodMetadata(intent.id, {
      method: instrument.method,
      masked: result.masked,
      label: result.label,
      gatewayOrderId,
      gatewayPaymentId,
    });

    const captured = await this.onCaptured(
      intent.id,
      bookingId,
      gatewayPaymentId,
      booking.totalMinor,
    );

    this.log.info(
      { bookingId, method: instrument.method, pnr: captured.pnr },
      'test payment captured',
    );
    return {
      status: 'captured',
      pnr: captured.pnr,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
      method: instrument.method,
      instrument: result.masked,
      label: result.label,
    };
  }

  /** Map the AppConfig test block to the domain validator's config shape. */
  private testConfig(): TestGatewayConfig {
    return { ...this.config.payment.test };
  }

  /**
   * Process a raw PSP webhook. `rawBody` MUST be the exact bytes received — the
   * signature is computed over them, so any re-serialisation breaks
   * verification (Fastify is configured to preserve the raw body on this route).
   */
  /**
   * PSP webhook. Guarantees:
   *  - signature verified before anything else;
   *  - exactly-once per (event type, payment/refund id) — NOT per payment
   *    id alone, since one payment legitimately emits authorized → captured
   *    → refund.processed;
   *  - a TRANSIENT failure (DB blip, lock timeout) forgets the dedupe row and
   *    returns 5xx, so the PSP's retry is processed rather than dropped;
   *  - a PERMANENT failure (seat already gone) is kept, logged CRITICAL for a
   *    manual refund — retrying would never succeed;
   *  - refund.* events are handed to the refunds module (via the outbox) so a
   *    gateway refund finally reaches 'settled' without staff intervention.
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<{ handled: boolean }> {
    const verified = this.gateway.verifyWebhook(rawBody, headers);
    if (!verified.valid || !verified.event) {
      this.log.warn({ reason: verified.reason }, 'rejected webhook with invalid signature');
      throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, 401, {
        message: 'Invalid webhook signature',
      });
    }
    const event = verified.event;
    const dedupeKey = webhookDedupeKey(event);

    const fresh = await this.payments.recordWebhookOnce(
      this.gateway.name,
      dedupeKey,
      event.type,
      event,
    );
    if (!fresh) {
      this.log.info({ dedupeKey }, 'duplicate webhook ignored');
      return { handled: true };
    }

    try {
      const result = await this.processWebhookEvent(event);
      await this.payments.markWebhookProcessed(this.gateway.name, dedupeKey);
      return result;
    } catch (err) {
      if (isPermanentFulfilmentError(err)) {
        await this.payments
          .markWebhookProcessed(this.gateway.name, dedupeKey)
          .catch(() => undefined);
        this.log.error(
          {
            err,
            gatewayPaymentId: event.gatewayPaymentId,
            amountMinor: event.amountMinor,
            type: event.type,
          },
          'CRITICAL: payment captured by gateway but booking could not be fulfilled — requires manual refund, see this log entry for the exact amount/gatewayPaymentId',
        );
        return { handled: true };
      }
      await this.payments.forgetWebhook(this.gateway.name, dedupeKey).catch(() => undefined);
      this.log.error({ err, dedupeKey }, 'webhook processing failed transiently — PSP will retry');
      throw new AppError(ErrorCode.COMMON_INTERNAL, 503, {
        message: 'Temporarily unable to process webhook',
        retryable: true,
      });
    }
  }

  private async processWebhookEvent(
    event: NonNullable<WebhookVerification['event']>,
  ): Promise<{ handled: boolean }> {
    if (event.type.startsWith('refund.')) {
      const intent = await this.payments.findByGatewayPaymentId(
        this.gateway.name,
        event.gatewayPaymentId,
      );
      if (!intent || !event.gatewayRefundId) {
        this.log.warn(
          { gatewayPaymentId: event.gatewayPaymentId },
          'refund webhook for unknown payment',
        );
        return { handled: false };
      }
      return runInNewContext(
        { tenantId: intent.tenantId as never, actorType: 'system' },
        async () => {
          await this.uow.run(
            { name: 'payment.refundWebhook', tenantId: intent.tenantId as never },
            async () => {
              this.events.publish({
                type: 'refund.gateway_update',
                aggregateType: 'payment',
                aggregateId: intent.id,
                payload: {
                  gatewayRefundId: event.gatewayRefundId!,
                  status: event.refundOutcome ?? 'processed',
                },
              });
            },
          );
          return { handled: true };
        },
      );
    }

    const intent = await this.payments.findByOrderId(this.gateway.name, event.gatewayOrderId);
    if (!intent) {
      this.log.warn({ orderId: event.gatewayOrderId }, 'webhook for unknown order');
      return { handled: false };
    }
    return runInNewContext(
      { tenantId: intent.tenantId as never, actorType: 'system' },
      async () => {
        if (event.type === 'payment.captured' || event.status === 'captured') {
          // Seat-upgrade differential payments branch BEFORE onCaptured (which
          // confirms a fresh booking). This is the ONLY place an upgrade's swap
          // + ledger entry happen — never before real money is captured.
          if (intent.metadata?.kind === 'seat_upgrade') {
            await this.captureSeatUpgrade(intent, event.gatewayPaymentId);
          } else {
            await this.onCaptured(
              intent.id,
              intent.bookingId,
              event.gatewayPaymentId,
              event.amountMinor,
            );
          }
        } else if (event.type === 'payment.failed' || event.status === 'failed') {
          await this.payments.markFailed(intent.id, 'gateway reported failure');
          await this.uow.run(
            { name: 'payment.failedEvent', tenantId: intent.tenantId as never },
            async () => {
              this.events.publish({
                type: 'payment.failed',
                aggregateType: 'payment',
                aggregateId: intent.id,
                payload: { bookingId: intent.bookingId },
              });
            },
          );
        }
        return { handled: true };
      },
    );
  }

  /**
   * Client-side checkout verification — called right after Razorpay
   * Checkout.js's `handler` fires, so the UI can show the confirmed PNR
   * immediately instead of waiting for the async webhook. Cryptographically
   * verified (delegates to the gateway's own signature check) — this is NOT
   * "trust whatever the client says" like the old public confirm endpoint
   * was; a forged payload fails the signature and is rejected. The webhook
   * still runs too (defence in depth) — `bookingService.confirm` is
   * idempotent, so whichever of the two arrives first wins and the second
   * is a no-op.
   */
  async verifyAndCapture(
    bookingId: BookingId,
    callbackPayload: Record<string, string>,
  ): Promise<{ pnr: string }> {
    const verified = this.gateway.verifyClientCallback(callbackPayload);
    if (!verified.valid || !verified.gatewayPaymentId || !verified.gatewayOrderId) {
      throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, 401, {
        message: verified.reason ?? 'Invalid payment signature',
      });
    }
    const intent = await this.payments.findByOrderId(this.gateway.name, verified.gatewayOrderId);
    if (!intent || intent.bookingId !== bookingId) {
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Payment intent not found for this booking',
      });
    }
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    return this.onCaptured(intent.id, bookingId, verified.gatewayPaymentId, booking.totalMinor);
  }

  /**
   * Confirm a booking sold through the platform GDS (an OTA / multi-operator
   * agent). The partner's GDS account has ALREADY been debited the net price
   * (GdsService does it first, under a row lock). The platform holds that
   * money, so this is a normal platform capture of the FULL ticket value plus
   * a partner-commission entry that moves the partner's commission out of the
   * operator's share. Idempotent per booking (intent reused on retry).
   */
  async confirmGdsBooking(
    bookingId: BookingId,
    partnerId: string,
    partnerCommissionMinor: number,
  ): Promise<{ pnr: string }> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    const existing = await this.payments.findByBookingAndGateway(bookingId, 'gds');
    if (existing?.status === 'captured') return { pnr: booking.pnr };
    const intent =
      existing ??
      (await this.payments.createIntent({
        bookingId,
        gateway: 'gds',
        amountMinor: booking.totalMinor,
        currency: booking.currency,
        metadata: { partnerId },
      }));
    const result = await this.onCaptured(
      intent.id,
      bookingId,
      `gds_${partnerId}_${bookingId}`,
      booking.totalMinor,
    );
    const entry = partnerCommissionEntry({
      currency: booking.currency as never,
      bookingId,
      operatorId: requireTenantId(),
      partnerCommissionMinor,
    });
    if (entry)
      await this.uow.run(
        { name: 'payment.gdsCommission', tenantId: requireTenantId() },
        async () => {
          await this.ledger.post(entry);
        },
      );
    return result;
  }

  /**
   * Confirm a booking sold by a B2B AGENT. The agent's account has ALREADY
   * been debited (AgentService does that first, under a row lock) — the
   * money sits with the OPERATOR, so this books the platform ledger as an
   * OFFLINE capture (commission owed by the operator; no gateway_clearing).
   * Idempotent exactly like confirmPartnerBooking: any prior 'agent' intent
   * for this booking is reused, so a retry can never post a second entry.
   */
  async confirmAgentBooking(bookingId: BookingId, agentId: string): Promise<{ pnr: string }> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    const intent =
      (await this.payments.findByBookingAndGateway(bookingId, 'agent')) ??
      (await this.payments.createIntent({
        bookingId,
        gateway: 'agent',
        amountMinor: booking.totalMinor,
        currency: booking.currency,
      }));
    return this.onCaptured(
      intent.id,
      bookingId,
      `agent_${agentId}_${bookingId}`,
      booking.totalMinor,
      booking.totalMinor,
      undefined,
      'operator',
    );
  }

  /**
   * Seat upgrade — seater→sleeper or similar, on the SAME booking/PNR,
   * before a 1-hour-before-departure cutoff. Charges only the DIFFERENCE
   * between the new seat type's fare and the old one (both resolved the
   * SAME way any other quote is — see FareRepository.resolveFare), with its
   * own GST on just that differential. This is a SEPARATE capture (its own
   * payment_intent, its own onCaptured() call) layered on top of the
   * original booking capture — the ledger ends up with commission/GST on
   * the original fare AND commission/GST on the upgrade differential,
   * exactly as if the customer had paid the higher fare from the start,
   * split across two transactions instead of one.
   *
   * The actual seat swap (inventory bitmap release/occupy + the ticket's
   * seat_number) happens FIRST, inside the SAME transaction as the audit
   * row — if the differential capture fails afterward, the customer is
   * sitting in the new seat but hasn't paid the difference yet, which is a
   * FAR safer failure mode than charging someone for a seat swap that
   * silently didn't happen.
   */
  /**
   * @remarks CRITICAL FIX: this method used to swap the seat FIRST and then
   * call a fake "capture" that never actually charged anything — createIntent()
   * only creates a payment_intents ROW, it does not move real money; the real
   * charge happens on the Razorpay checkout screen, confirmed only by a signed
   * webhook. The previous version immediately marked its own synthetic
   * gatewayPaymentId as captured without ANY of that happening, meaning
   * every single seat upgrade was completely free — a customer could
   * upgrade to any higher fare class with zero actual payment, while the
   * ledger recorded (fake) revenue as if it had been collected. That is
   * fixed here: this method now ONLY validates and creates a real gateway
   * order, returning clientPayload for the customer to complete Razorpay
   * checkout with. The seat is swapped and the differential is posted to
   * the ledger ONLY when the webhook (handleWebhook, in this same class)
   * confirms a REAL capture for this intent — see the 'seat_upgrade'
   * metadata branch there.
   */
  async upgradeSeat(
    ticketId: string,
    toSeatNumber: string,
  ): Promise<{
    intentId: PaymentId;
    clientPayload: Record<string, unknown>;
    differentialMinor: number;
  }> {
    const ticket = await this.seatUpgrades.getTicketWithSeatType(ticketId);
    if (!ticket)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Ticket not found' });
    if (ticket.seatNumber === toSeatNumber)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Already in that seat' });

    const booking = await this.bookings.findForUpdate(ticket.bookingId as BookingId);
    if (!booking)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

    const trip = await this.trips.getById(ticket.tripId as never);
    if (trip.status === 'departed' || trip.status === 'cancelled') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Trip has already departed — cannot upgrade',
      });
    }
    const cutoff = new Date(trip.departsAt.getTime() - 60 * 60 * 1000); // 1hr before departure
    if (new Date() > cutoff) {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Upgrades close 1 hour before departure',
      });
    }

    const toSeatType = await this.seatUpgrades.seatType(ticket.tripId as never, toSeatNumber);
    if (!toSeatType)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: `Seat ${toSeatNumber} not found on this trip`,
      });

    const route = await this.routes.getById(trip.routeId);
    const fromStop = route.path.stops.find((s) => s.sequence === booking.fromSeq);
    const toStop = route.path.stops.find((s) => s.sequence === booking.toSeq);
    if (!fromStop || !toStop)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Could not resolve the booked segment',
      });
    const segmentDistanceM = Math.max(0, toStop.distanceFromOriginM - fromStop.distanceFromOriginM);

    const [oldFare, newFare] = await Promise.all([
      this.fares.resolveFare({
        routeId: trip.routeId,
        fromStopId: fromStop.stopId,
        toStopId: toStop.stopId,
        seatType: ticket.seatType,
        distanceM: segmentDistanceM,
        journeyDate: trip.journeyDate,
      }),
      this.fares.resolveFare({
        routeId: trip.routeId,
        fromStopId: fromStop.stopId,
        toStopId: toStop.stopId,
        seatType: toSeatType,
        distanceM: segmentDistanceM,
        journeyDate: trip.journeyDate,
      }),
    ]);
    if (!newFare)
      throw new AppError(ErrorCode.PRICING_NO_FARE_DEFINED, 422, {
        message: `No fare defined for ${toSeatType} on this segment`,
      });
    const differentialFareMinor = newFare.baseFareMinor - (oldFare?.baseFareMinor ?? 0);
    if (differentialFareMinor <= 0) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message:
          'That seat is not an upgrade (same or lower fare) — use a normal seat change instead',
      });
    }
    const gstRatePct = (await this.fares.routePricing(trip.routeId)).gstRatePct;
    const differentialTaxMinor = Math.round((differentialFareMinor * gstRatePct) / 100);
    const differentialTotalMinor = differentialFareMinor + differentialTaxMinor;

    // NOTHING is swapped or charged yet — only a real gateway order,
    // carrying everything the webhook will need to actually perform the
    // swap once (and only once) a real capture is confirmed. The NEW seat
    // is NOT locked/reserved here either: exactly like a fresh booking's
    // hold-then-pay flow, there's a genuine (small) race where someone
    // else could take toSeatNumber while this customer is on the Razorpay
    // screen — the webhook branch re-validates the seat is still free
    // before swapping, and fails the upgrade (refunding, see below) if not.
    const intent = await this.payments.createIntent({
      bookingId: booking.id,
      gateway: this.gateway.name,
      amountMinor: differentialTotalMinor,
      currency: booking.currency,
      metadata: {
        kind: 'seat_upgrade',
        ticketId,
        tripId: ticket.tripId,
        fromSeq: booking.fromSeq,
        toSeq: booking.toSeq,
        stopCount: trip.stopCount,
        fromSeatNumber: ticket.seatNumber,
        toSeatNumber,
        fromSeatType: ticket.seatType,
        toSeatType,
        differentialFareMinor,
        differentialTaxMinor,
        routeId: trip.routeId,
      },
    });
    const created = await this.gateway.createIntent({
      intentId: intent.id,
      amountMinor: differentialTotalMinor,
      currency: booking.currency,
      bookingId: booking.id,
      callbackUrl: `${this.config.app.publicBaseUrl}/api/v1/payments/webhook/${this.gateway.name}`,
    });
    await this.payments.setGatewayOrder(intent.id, created.gatewayOrderId);

    return {
      intentId: intent.id,
      clientPayload: created.clientPayload,
      differentialMinor: differentialTotalMinor,
    };
  }

  /**
   * Capture: confirm booking + post the ledger, atomically. Returns the PNR.
   *
   * EXACTLY-ONCE by design, not by accident: this can legitimately be called
   * TWICE for the same real payment (the webhook and the client-side verify
   * both call it — see verifyAndCapture's docstring). `lockIntentForCapture`
   * takes a row lock on the intent FIRST, inside this same transaction, and
   * everything below only runs if the intent ISN'T already 'captured' — the
   * second caller sees the first caller's committed status and returns the
   * existing PNR without posting a second ledger entry. Without this, a
   * booking's commission/payable would be double-counted for every payment
   * that both paths happen to process (the common case, not an edge case).
   *
   * TWO amounts, deliberately: `confirmAmountMinor` is what the BOOKING
   * considers itself paid — this MUST be the full booking.totalMinor,
   * because BookingService.confirm() legitimately rejects underpayment
   * (fraud protection: someone paying less than owed must never get a
   * confirmed ticket). `ledgerAmountMinor` is what actually reached the
   * PLATFORM's own books through THIS channel — for a direct/counter-cash/
   * webhook/partner capture these are the SAME number, but for an
   * agent-wallet capture they're NOT: the passenger DID pay the full fare in
   * cash to the agent (the booking is fully "paid", confirmAmountMinor =
   * totalMinor), but the agent kept their own commission before the rest
   * ever reached the platform (ledgerAmountMinor = totalMinor − agent's
   * cut). Passing netMinor for BOTH — the bug this replaces — made
   * confirm() reject every single agent booking outright (paid < total is
   * exactly the underpayment check firing on legitimate agent income).
   */
  private async onCaptured(
    intentId: PaymentId,
    bookingId: BookingId,
    gatewayPaymentId: string,
    confirmAmountMinor: number,
    ledgerAmountMinor: number = confirmAmountMinor,
    ledgerTaxMinor?: number,
    collectedBy: 'platform' | 'operator' = 'platform',
  ): Promise<{ pnr: string }> {
    // Confirm the booking (own transaction; idempotent on booking status).
    const result = await this.bookingService.confirm(bookingId, {
      paidMinor: confirmAmountMinor,
      reference: gatewayPaymentId,
    });

    // Post accounting in one transaction with the payment status.
    let duplicate: { gateway: string } | null = null;
    await this.uow.run({ name: 'payment.capture', tenantId: requireTenantId() }, async () => {
      const intent = await this.payments.lockIntentForCapture(intentId);
      const decision = classifyCapture(intent, gatewayPaymentId);
      if (decision === null || decision === 'already_recorded') return; // exactly-once
      if (decision === 'duplicate') {
        // A SECOND payment for a booking that is already paid (1004): record
        // it; the full refund is sent after this transaction commits.
        if (
          await this.payments.recordDuplicate({
            intentId,
            bookingId,
            gateway: intent!.gateway,
            gatewayPaymentId,
            amountMinor: confirmAmountMinor,
          })
        )
          duplicate = { gateway: intent!.gateway };
        return;
      }

      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) return;

      // The tax portion of THIS capture. Callers that reduce ONLY the fare
      // (agent-wallet: the agent's commission comes out of the fare alone,
      // never the ticket's GST — the operator must remit that in FULL
      // regardless of which channel sold the ticket) pass ledgerTaxMinor
      // explicitly as booking.taxMinor, UNCHANGED. Only when no explicit tax
      // is given do we fall back to proportional scaling — correct for a
      // capture that legitimately reduces fare AND tax together in lockstep
      // (there is no such caller today, but this keeps the fallback sane
      // rather than assuming zero tax by default).
      const taxPortionMinor =
        ledgerTaxMinor ??
        (booking.totalMinor > 0
          ? Math.round((ledgerAmountMinor * booking.taxMinor) / booking.totalMinor)
          : 0);

      // Commission from the operator's config (default from platform settings
      // if unset). Charged on the NET fare EXCLUDING GST — see
      // domain/commission.ts's own invariant: tax is a pass-through the
      // OPERATOR collects and remits, never something the platform earns
      // commission on. Using the tax-INCLUSIVE total here would silently
      // inflate commission by taxing the tax.
      const config = (await this.payments.loadCommissionConfig(
        booking.routeId,
      )) as CommissionConfig;
      const netFareMinor = ledgerAmountMinor - taxPortionMinor;
      const { commission } = computeCommission({
        netFareMinor,
        seatCount: booking.seatCount,
        config,
      });

      // The platform's OWN revenue is ONLY the commission plus GST on that
      // commission (a separate, standard-rate taxable service — see
      // migration 0023). The fare AND the ticket's own GST both flow to the
      // operator undiminished — they are the transport supplier and remit
      // that tax themselves; the platform was never entitled to hold it.
      const commissionGstRatePct = await this.platformSettings.commissionGstRatePercent();
      const commissionGstMinor = Math.round((commission.minor * commissionGstRatePct) / 100);

      // Operator-collected (B2B agent) sales never touched our gateway — book
      // only the commission the operator now owes us (see offlineCaptureEntry).
      const entry =
        collectedBy === 'operator'
          ? offlineCaptureEntry({
              currency: booking.currency as never,
              bookingId,
              operatorId: requireTenantId(),
              commissionMinor: commission.minor,
              commissionGstMinor,
            })
          : captureEntry({
              currency: booking.currency as never,
              bookingId,
              operatorId: requireTenantId(),
              totalMinor: ledgerAmountMinor,
              commissionMinor: commission.minor,
              commissionGstMinor,
            });
      await this.ledger.post(entry);
      await this.payments.markCaptured(intentId, gatewayPaymentId);
      this.events.publish({
        type: 'payment.captured',
        aggregateType: 'payment',
        aggregateId: intentId,
        payload: { bookingId, pnr: result.pnr, amount: ledgerAmountMinor },
      });
    });

    if (duplicate) {
      await this.refundDuplicate(gatewayPaymentId, confirmAmountMinor, bookingId);
      return { pnr: result.pnr };
    }
    this.metrics.bookings.inc({
      outcome: 'paid',
      channel: collectedBy === 'operator' ? 'agent' : 'direct',
    });
    return { pnr: result.pnr };
  }

  /**
   * Refund an extra capture in full — OUTSIDE any transaction, idempotency key
   * `dup_<paymentId>` so a re-send can never refund twice. A PSP error leaves
   * the row pending; retryDuplicateRefunds() re-sends it.
   */
  private async refundDuplicate(
    gatewayPaymentId: string,
    amountMinor: number,
    bookingId: string,
  ): Promise<void> {
    try {
      const r = await this.gateway.refund({
        gatewayPaymentId,
        amountMinor,
        refundId: `dup_${gatewayPaymentId}`,
      });
      await this.payments.duplicateOutcome(
        this.gateway.name,
        gatewayPaymentId,
        r.status === 'failed'
          ? {
              status: 'refund_failed',
              gatewayRefundId: r.gatewayRefundId,
              reason: 'gateway rejected the refund',
            }
          : { status: 'refunded', gatewayRefundId: r.gatewayRefundId },
      );
      this.log.warn(
        { bookingId, gatewayPaymentId, amountMinor, status: r.status },
        'duplicate payment detected and refunded',
      );
      await this.uow.run(
        { name: 'payment.duplicateEvent', tenantId: requireTenantId() },
        async () => {
          this.events.publish({
            type: 'payment.duplicate_refunded',
            aggregateType: 'booking',
            aggregateId: bookingId,
            payload: { gatewayPaymentId, amountMinor, refundStatus: r.status },
          });
        },
      );
    } catch (err) {
      this.log.error(
        { bookingId, gatewayPaymentId, err: err instanceof Error ? err.message : String(err) },
        'duplicate payment refund failed — will be retried',
      );
    }
  }

  /** Worker sweep (all operators): re-send duplicate refunds that did not complete — same idempotency key. */
  async retryDuplicateRefunds(): Promise<number> {
    const pending = await this.payments.pendingDuplicates();
    let sent = 0;
    for (const d of pending) {
      if (d.gateway !== this.gateway.name) continue;
      await runAsTenant(d.tenant_id as TenantId, () =>
        this.refundDuplicate(d.gateway_payment_id, Number(d.amount_minor), d.booking_id),
      );
      sent += 1;
    }
    return sent;
  }

  /**
   * Capture an ADDITIONAL payment on an ALREADY-CONFIRMED booking — the
   * seat-upgrade differential is the only current caller. This is
   * DELIBERATELY separate from onCaptured(): that method always computes
   * commission/GST off `booking.totalMinor` (the booking's ORIGINAL fare),
   * which is exactly correct for the first payment that confirms a booking
   * (every existing caller passes an amountMinor that equals
   * booking.totalMinor, so this was never visibly wrong before) but would
   * be a SEVERE double-counting bug here: reusing onCaptured() for a
   * differential would silently re-post the ENTIRE original fare a SECOND
   * time into gateway_clearing/operator_payable/platform_revenue, while the
   * actual (much smaller) differential collected from the customer would
   * have no correct representation in the books at all.
   *
   * Here, commission and GST are computed on THIS capture's OWN net/tax
   * split — passed in explicitly, never re-derived from the booking row —
   * and the ledger entry's `totalMinor` is THIS capture's amount, not the
   * booking's. Never calls bookingService.confirm() — the booking is
   * already confirmed; there is nothing to confirm.
   */
  /**
   * The ONLY place a seat-upgrade's seat-swap and ledger entry actually
   * happen — called exclusively from the webhook, once a REAL capture is
   * confirmed for an intent carrying seat_upgrade metadata (see
   * upgradeSeat()'s own doc comment for the critical bug this replaced:
   * the old code swapped the seat immediately and faked its own capture,
   * meaning every upgrade was free with zero real payment ever collected).
   *
   * Exactly-once via the same lockIntentForCapture()-then-check-status
   * pattern onCaptured() uses — a webhook retry (or the rare case of two
   * gateway callbacks for the same event) must never swap the seat or post
   * the ledger entry twice for one real charge.
   *
   * The new seat's availability was intentionally NOT locked/reserved when
   * the intent was created — exactly like a fresh booking's hold-then-pay
   * flow, the customer could spend several minutes on the Razorpay screen.
   * swapSeat() itself re-validates the target seat is still free (row-locked,
   * throws if taken) before touching anything; if someone else took it in
   * the meantime, the catch block below logs CRITICALLY for a manual refund
   * — real money has already been collected by the gateway by this point,
   * and (same reasoning as the normal-booking webhook catch block) there is
   * no safe, verified automatic-refund path to improvise here.
   */
  private async captureSeatUpgrade(intent: PaymentIntent, gatewayPaymentId: string): Promise<void> {
    const locked = await this.payments.lockIntentForCapture(intent.id);
    if (!locked || locked.status === 'captured') return; // already processed — exactly-once

    const m = intent.metadata as {
      ticketId: string;
      tripId: string;
      fromSeq: number;
      toSeq: number;
      stopCount: number;
      fromSeatNumber: string;
      toSeatNumber: string;
      fromSeatType: string;
      toSeatType: string;
      differentialFareMinor: number;
      differentialTaxMinor: number;
      routeId: string;
    };

    try {
      await this.uow.run(
        { name: 'seatUpgrade.captureSwap', tenantId: requireTenantId() },
        async () => {
          await this.seatUpgrades.swapSeat(
            m.tripId as never,
            m.stopCount,
            m.fromSeq,
            m.toSeq,
            m.fromSeatNumber,
            m.toSeatNumber,
          );
          await this.seatUpgrades.updateTicketSeat(m.ticketId, m.toSeatNumber);
          await this.seatUpgrades.recordUpgrade({
            bookingId: intent.bookingId,
            ticketId: m.ticketId,
            fromSeatNumber: m.fromSeatNumber,
            toSeatNumber: m.toSeatNumber,
            fromSeatType: m.fromSeatType,
            toSeatType: m.toSeatType,
            differentialFareMinor: m.differentialFareMinor,
            differentialTaxMinor: m.differentialTaxMinor,
          });

          const config = (await this.payments.loadCommissionConfig(m.routeId)) as CommissionConfig;
          const { commission } = computeCommission({
            netFareMinor: m.differentialFareMinor,
            seatCount: 1,
            config,
          });
          const commissionGstRatePct = await this.platformSettings.commissionGstRatePercent();
          const commissionGstMinor = Math.round((commission.minor * commissionGstRatePct) / 100);

          const entry = captureEntry({
            currency: intent.currency as never,
            bookingId: intent.bookingId,
            operatorId: requireTenantId(),
            totalMinor: intent.amountMinor,
            commissionMinor: commission.minor,
            commissionGstMinor,
          });
          await this.ledger.post(entry);
          await this.payments.markCaptured(intent.id, gatewayPaymentId);
        },
      );
    } catch (err) {
      this.log.error(
        {
          err,
          intentId: intent.id,
          bookingId: intent.bookingId,
          gatewayPaymentId,
          amountMinor: intent.amountMinor,
          toSeatNumber: m.toSeatNumber,
        },
        'CRITICAL: seat-upgrade payment captured by gateway but the seat swap could not be completed (likely taken concurrently) — requires manual refund',
      );
    }
  }
}

/**
 * A capture that can never be fulfilled by retrying: the seat is gone, the
 * hold expired, the booking is in a state that cannot be confirmed. Anything
 * else (DB/network/lock errors) is treated as transient and retried by the PSP.
 */
function isPermanentFulfilmentError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  const permanent: string[] = [
    ErrorCode.INVENTORY_SEAT_UNAVAILABLE,
    ErrorCode.INVENTORY_HOLD_EXPIRED,
    ErrorCode.BOOKING_INVALID_STATE,
    ErrorCode.PAYMENT_AMOUNT_MISMATCH,
    ErrorCode.COMMON_NOT_FOUND,
    ErrorCode.COMMON_VALIDATION,
  ];
  // Decided by the code alone: some of these carry retryable=true for an
  // interactive user (e.g. "seat taken, pick another"), but a webhook retry
  // of the SAME capture can never succeed.
  return permanent.includes(err.code);
}
