import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { DatabaseService, isUniqueViolation, UnitOfWork } from '@database';
import {
  AppError, ErrorCode, getUserId, requireTenantId,
  type BookingId, type TripId, type UserId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger, Metrics } from '@observability';

import { PricingService } from '../../../pricing/application/services/pricing.service';
import { CouponRepository } from '../../../pricing/infrastructure/persistence/coupon.repository';
import { TripRepository } from '../../../scheduling/infrastructure/persistence/trip.repository';
import { CustomerRepository } from '../../../crm/infrastructure/persistence/customer.repository';
import { assertTransition, isCancellable } from '../../domain/booking-state';
import { computeRefund, DEFAULT_REFUND_POLICY, type RefundPolicy } from '../../domain/refund-policy';
import { generatePnr, ticketCode } from '../../domain/pnr';
import { BookingRepository } from '../../infrastructure/persistence/booking.repository';
import { SeatLockRepository } from '../../infrastructure/persistence/seat-lock.repository';
import { HoldValidationError, normaliseSeat, resolveSeatFares, validateHoldSelection } from '../../domain/hold-validation';
import { QuotaRuleError, validatePhoneHoldUntil } from '../../../quotas/domain/quota-rules';
import { applyConcessions, checkBookingWindow, PassengerRuleError, validatePassengers, type Category, type Infant } from '../../domain/passenger-categories';
import { ConcessionRepository } from '../../infrastructure/persistence/concession.repository';

export interface HoldOptions {
  holdUntil?: Date;
  beforeLock?: (tripId: TripId, seatNumbers: string[]) => Promise<void>;
}

export interface HoldRequest {
  quoteId: string;
  seatNumbers: string[];
  passengers: { seatNumber: string; fullName: string; age?: number; gender?: string; category?: Category; idProof?: string }[];
  /** Lap infants (no seat), each with an adult guardian's seat. */
  infants?: Infant[];
  channel?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/**
 * ============================================================================
 *  Booking saga — hold → confirm → (cancel)
 * ============================================================================
 *
 * The end-to-end purchase flow, each step ONE unit of work so it is atomic and,
 * where money or inventory is involved, idempotent.
 *
 *  HOLD:    re-validate the quote (price integrity), lock the seats under a row
 *           lock (the anti-double-sell gate), write a `held` booking with a TTL.
 *           No money moves yet.
 *
 *  CONFIRM: re-lock the booking + seats, atomically redeem the coupon, OR the
 *           seat masks into `occupied_legs` (committing the sale), issue the
 *           PNR + tickets, mark `confirmed`. Payment capture is Part 8; here the
 *           booking records `paid_minor` from the payment result passed in.
 *
 *  CANCEL:  validate the transition, compute the refund from the time-to-
 *           departure policy, release the seat occupancy, mark `cancelled`, and
 *           record the refund (money movement in Part 8).
 *
 * The seat-hold sweeper (Part 9) expires stale holds, freeing their inventory.
 */
@Injectable()
export class BookingService {
  private readonly log: Logger;

  constructor(
    private readonly bookings: BookingRepository,
    private readonly seatLock: SeatLockRepository,
    private readonly pricing: PricingService,
    private readonly concessions: ConcessionRepository,
    private readonly coupons: CouponRepository,
    private readonly trips: TripRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly config: AppConfig,
    private readonly customers: CustomerRepository,
    private readonly db: DatabaseService,
    logger: Logger,
    private readonly metrics: Metrics,
  ) {
    this.log = logger.forContext('BookingService');
  }

  /**
   * This operator's own cancellation tiers if they've set one, else the
   * platform default — see migration 0037's own comment for why this
   * exists. Queries `tenants` directly via DatabaseService rather than
   * injecting TenantRepository: TenancyModule already imports BookingModule
   * (for TripOpsService-adjacent needs), so importing TenancyModule back
   * here would create a circular module dependency.
   */
  private async loadRefundPolicy(): Promise<RefundPolicy> {
    const row = await this.db.queryOne<{ refund_policy: RefundPolicy | null }>(
      `SELECT refund_policy FROM tenants WHERE id = $1`,
      [requireTenantId()],
      { name: 'booking.loadRefundPolicy', primary: true },
    );
    return row?.refund_policy ?? DEFAULT_REFUND_POLICY;
  }

  /** Step 1 — hold seats against a valid quote. */
  /**
   * @param opts.holdUntil  phone booking only: keep the seats until this
   *   instant instead of the checkout TTL (validated against departure).
   *   Deliberately NOT part of HoldRequest — the public checkout DTO can
   *   never set it.
   * @param opts.beforeLock runs inside the hold transaction right before the
   *   seat-lock gate (e.g. consume the caller's own seat quota) — atomic with
   *   the hold, so nobody can take the freed seat in between.
   */
  async hold(req: HoldRequest, opts: HoldOptions = {}): Promise<{ bookingId: BookingId; pnr: string; holdExpiresAt: string; totalMinor: number }> {
    // Independent reads in parallel: one round-trip of latency, not two.
    const [blocked, cachedQuote] = await Promise.all([
      req.contactPhone ? this.customers.isBlacklistedByPhone(req.contactPhone) : Promise.resolve(false),
      this.pricing.getQuote(req.quoteId),
    ]);
    if (blocked) throw new AppError(ErrorCode.COMMON_VALIDATION, 403, { message: 'This account cannot make new bookings — please contact support' });
    if (!cachedQuote) throw new AppError(ErrorCode.PRICING_QUOTE_EXPIRED, 422, { message: 'Price quote has expired; please refresh' });

    const quote = await this.quoteForSeats(cachedQuote, req);
    const fareBySeat = asHoldError(() => resolveSeatFares(quote, req.seatNumbers));
    if (fareBySeat.kind !== 'priced') throw new AppError(ErrorCode.COMMON_INTERNAL, 500, { message: 'Seat pricing could not be resolved' });

    const trip = await this.trips.getById(quote.tripId);
    // Passenger categories & concessions — the same rules on every channel.
    const [concessionRules, passengerPolicy, bookingWindow] = await Promise.all([this.concessions.rules(), this.concessions.policy(), this.concessions.bookingWindow()]);
    // The operator's booking window applies on EVERY channel (web, agent, OTA, phone).
    const windowProblem = checkBookingWindow(trip.departsAt, bookingWindow);
    if (windowProblem) throw new AppError(ErrorCode.INVENTORY_TRIP_CLOSED, 422, { message: windowProblem });
    try {
      validatePassengers({ passengers: req.passengers, infants: req.infants ?? [], rules: concessionRules, policy: passengerPolicy, journeyDate: trip.journeyDate });
    } catch (e) {
      if (e instanceof PassengerRuleError) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
      throw e;
    }
    const priced = applyConcessions({
      fareBySeat: fareBySeat.fareBySeat, passengers: req.passengers, rules: concessionRules, policy: passengerPolicy, infantCount: req.infants?.length ?? 0,
      totals: { baseMinor: quote.totalBaseMinor, discountMinor: quote.totalDiscountMinor, taxMinor: quote.totalTaxMinor, totalMinor: quote.totalMinor },
    });
    // Channel-wise sales control: e.g. OTA sales stopped for a trip while
    // the operator's own website keeps selling.
    const family = channelFamily(req.channel);
    if ((await this.trips.closedChannels(trip.id)).includes(family)) {
      throw new AppError(ErrorCode.INVENTORY_TRIP_CLOSED, 422, { message: 'Sales are closed for this trip on this channel' });
    }
    const holdTtl = this.config.domain.seatHoldTtlSeconds;
    if (opts.holdUntil) {
      try {
        validatePhoneHoldUntil(opts.holdUntil, trip.departsAt);
      } catch (e) {
        if (e instanceof QuotaRuleError) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
        throw e;
      }
    }
    // ONE instant: stored and returned identically.
    const holdExpiresAt = opts.holdUntil ?? new Date(Date.now() + holdTtl * 1000);
    const userId = (getUserId() ?? null) as UserId | null;

    return this.uow.run({ name: 'booking.hold', tenantId: requireTenantId(), isolation: 'read committed' }, async () => {
      // The anti-double-sell gate: row-lock + bitmap + hold-overlap check.
      if (opts.beforeLock) await opts.beforeLock(trip.id, req.seatNumbers.map((s) => s.trim()));
      const locked = await this.seatLock.lockSeats({
        tripId: quote.tripId,
        seatNumbers: req.seatNumbers,
        fromSeq: quote.fromSeq,
        toSeq: quote.toSeq,
        stopCount: trip.stopCount,
        passengerGenderBySeat: Object.fromEntries(req.passengers.map((p) => [p.seatNumber, p.gender])),
      });

      // Each seat records what IT cost (seat overrides differ), so a partial
      // cancellation refunds exactly that seat's fare.
      const seats = locked.map((s) => ({ ...s, fareMinor: priced.fareBySeat.get(normaliseSeat(s.seatNumber)) ?? 0 }));

      const pnr = await this.insertWithPnrRetry((pnr) =>
        this.bookings.insertHeld({
          pnr,
          tripId: quote.tripId,
          routeId: trip.routeId,
          fromSeq: quote.fromSeq,
          toSeq: quote.toSeq,
          fromStopId: quote.fromStopId,
          toStopId: quote.toStopId,
          channel: req.channel ?? 'direct_web',
          customerId: userId,
          contactEmail: req.contactEmail,
          contactPhone: req.contactPhone,
          currency: quote.currency,
          baseMinor: priced.totals.baseMinor,
          discountMinor: priced.totals.discountMinor,
          taxMinor: priced.totals.taxMinor,
          totalMinor: priced.totals.totalMinor,
          couponCode: quote.couponCode,
          quoteId: req.quoteId,
          fareBreakup: quote.perSeat,
          holdExpiresAt,
          seats,
          passengers: req.passengers,
          infants: (req.infants ?? []).map((i) => ({ ...i, feeMinor: passengerPolicy.infantFeeMinor })),
        }),
      );

      this.metrics.seatHolds.inc({ outcome: 'ok' });
      this.events.publish({
        type: 'booking.seats_held',
        aggregateType: 'booking',
        aggregateId: pnr.bookingId,
        payload: { tripId: quote.tripId, seats: req.seatNumbers, pnr: pnr.pnr },
      });

      return {
        bookingId: pnr.bookingId,
        pnr: pnr.pnr,
        holdExpiresAt: holdExpiresAt.toISOString(),
        totalMinor: priced.totals.totalMinor,
      };
    });
  }

  /**
   * Validate the selection against the quote and, for a count-only quote
   * (some OTA flows price "2 seats" before choosing them), re-price for the
   * exact seats chosen. If that price differs, the caller must accept the new
   * quote — seats are never held at a price that was not quoted for them.
   */
  private async quoteForSeats(
    cached: NonNullable<Awaited<ReturnType<PricingService['getQuote']>>>, req: HoldRequest,
  ): Promise<NonNullable<Awaited<ReturnType<PricingService['getQuote']>>>> {
    asHoldError(() => validateHoldSelection(req.seatNumbers, req.passengers, cached.seatCount));
    if (cached.seatFares.length > 0) return cached;

    const fresh = await this.pricing.quote({
      tripId: cached.tripId, fromStopId: cached.fromStopId, toStopId: cached.toStopId, seatType: cached.seatType,
      seatNumbers: req.seatNumbers, couponCode: cached.couponCode ?? undefined,
    });
    if (fresh.totalMinor !== cached.totalMinor) {
      throw new AppError(ErrorCode.PRICING_QUOTE_EXPIRED, 409, {
        message: 'The selected seats are priced differently from the quote — please confirm the new price',
        details: { newQuoteId: fresh.quoteId, oldTotalMinor: cached.totalMinor, newTotalMinor: fresh.totalMinor },
      });
    }
    const reloaded = await this.pricing.getQuote(fresh.quoteId);
    if (!reloaded) throw new AppError(ErrorCode.PRICING_QUOTE_EXPIRED, 422, { message: 'Price quote has expired; please refresh' });
    return reloaded;
  }

  /** Phone booking: move the release time (only while still held, only for channel 'phone'). */
  async extendPhoneHold(bookingId: BookingId, holdUntil: Date): Promise<{ holdExpiresAt: string }> {
    return this.uow.run({ name: 'booking.extendPhoneHold', tenantId: requireTenantId() }, async (scope) => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      const ch = (await scope.client.query<{ channel: string }>(`SELECT channel FROM bookings WHERE tenant_id = $1 AND id = $2`, [requireTenantId(), bookingId])).rows[0]?.channel;
      if (ch !== 'phone') throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: 'Only a phone booking can have its release time changed' });
      if (booking.status !== 'held') throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: `This booking is ${booking.status}, not on hold` });
      if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) throw new AppError(ErrorCode.INVENTORY_HOLD_EXPIRED, 422, { message: 'The hold has already expired — the seats may have been released' });
      const trip = await this.trips.getById(booking.tripId);
      try {
        validatePhoneHoldUntil(holdUntil, trip.departsAt);
      } catch (e) {
        if (e instanceof QuotaRuleError) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
        throw e;
      }
      await scope.client.query(`UPDATE bookings SET hold_expires_at = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2 AND status = 'held'`, [requireTenantId(), bookingId, holdUntil]);
      return { holdExpiresAt: holdUntil.toISOString() };
    });
  }

  /** Step 2 — confirm a held booking after payment. */
  async confirm(bookingId: BookingId, payment: { paidMinor: number; reference?: string }): Promise<{ pnr: string; tickets: { seatNumber: string; boardingCode: string }[] }> {
    return this.uow.run({ name: 'booking.confirm', tenantId: requireTenantId(), isolation: 'read committed' }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });

      // Idempotency: a confirm on an already-confirmed booking replays cleanly.
      if (booking.status === 'confirmed') {
        const seats = await this.bookings.loadSeats(bookingId);
        return { pnr: booking.pnr, tickets: seats.map((s) => ({ seatNumber: s.seatNumber, boardingCode: ticketCode(booking.pnr, s.seatNumber) })) };
      }

      assertTransition(booking.status, 'confirmed');
      if (booking.holdExpiresAt && booking.holdExpiresAt < new Date()) {
        throw new AppError(ErrorCode.INVENTORY_HOLD_EXPIRED, 422, { message: 'Seat hold has expired' });
      }
      if (payment.paidMinor < booking.totalMinor) {
        throw new AppError(ErrorCode.PAYMENT_AMOUNT_MISMATCH, 422, {
          message: 'Paid amount is less than the booking total',
          details: { paid: payment.paidMinor, due: booking.totalMinor },
        });
      }

      // Redeem the coupon atomically (throws if it hit its cap meanwhile).
      if (booking.couponCode) await this.coupons.redeem(booking.couponCode);

      const seats = await this.bookings.loadSeats(bookingId);
      await this.seatLock.commitOccupancy(booking.tripId, seats);

      const tickets = seats.map((s) => ({ seatNumber: s.seatNumber, boardingCode: ticketCode(booking.pnr, s.seatNumber) }));
      await this.bookings.issueTickets(bookingId, booking.tripId, tickets);
      await this.bookings.setStatus(bookingId, 'confirmed', { paidMinor: payment.paidMinor });

      this.metrics.bookings.inc({ outcome: 'confirmed', channel: 'direct' });
      this.events.publish({
        type: 'booking.confirmed',
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: { pnr: booking.pnr, tripId: booking.tripId, seats: seats.map((s) => s.seatNumber), total: booking.totalMinor, customerId: booking.customerId, contactPhone: booking.contactPhone, contactEmail: booking.contactEmail },
      });

      return { pnr: booking.pnr, tickets };
    });
  }

  /** Read-only: what a cancellation would refund RIGHT NOW, without actually cancelling — so a customer/staff member can see the number before committing. Same policy, same math as cancel() itself; just no mutation. */
  async previewRefund(bookingId: BookingId): Promise<{ refundMinor: number; refundPct: number; cancellable: boolean; reason?: string }> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
    if (!isCancellable(booking.status)) {
      return { refundMinor: 0, refundPct: 0, cancellable: false, reason: `A ${booking.status} booking cannot be cancelled` };
    }
    const trip = await this.trips.getById(booking.tripId);
    if (trip.departsAt < new Date()) {
      return { refundMinor: 0, refundPct: 0, cancellable: false, reason: 'Trip has already departed' };
    }
    const refundPolicy = await this.loadRefundPolicy();
    const refund = computeRefund(booking.paidMinor, trip.departsAt, new Date(), refundPolicy, booking.currency as never);
    return { refundMinor: refund.refund.minor, refundPct: refund.refundPct, cancellable: true };
  }

  /** Cancel a held or confirmed booking, computing the refund. */
  /**
   * @param forceFullRefund When true, refunds 100% regardless of how close
   *   to departure this is — for operator-initiated cancellations (trip
   *   cancelled, connecting-leg broken by the OTHER leg failing), never
   *   for a customer's own voluntary cancel. Implemented as a one-tier
   *   override policy fed through the SAME computeRefund engine, rather
   *   than a separate code path — this guarantees the exact same
   *   rounding/Money-wrapping behaviour as every other refund, just with
   *   a policy that always resolves to 100%.
   */
  /**
   * @param refundDestination Defaults to 'source' (the original payment
   *   method) unless the customer explicitly picks 'alternate_account' and
   *   supplies altAccountDetails — see RefundConsumer, which reads these
   *   straight off this event's payload rather than defaulting blind.
   */
  async cancel(
    bookingId: BookingId, reason?: string, forceFullRefund = false,
    refundDestination: 'source' | 'alternate_account' = 'source',
    altAccountDetails?: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string },
  ): Promise<{ refundMinor: number; refundPct: number }> {
    return this.uow.run({ name: 'booking.cancel', tenantId: requireTenantId(), isolation: 'read committed' }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (!isCancellable(booking.status)) {
        throw new AppError(ErrorCode.BOOKING_NOT_CANCELLABLE, 422, { message: `A ${booking.status} booking cannot be cancelled` });
      }

      const trip = await this.trips.getById(booking.tripId);
      if (trip.departsAt < new Date()) {
        throw new AppError(ErrorCode.BOOKING_DEPARTED, 422, { message: 'Trip has already departed' });
      }

      const refundPolicy = forceFullRefund ? { tiers: [{ minHoursBeforeDeparture: 0, refundPct: 100 }] } : await this.loadRefundPolicy();
      const refund = computeRefund(booking.paidMinor, trip.departsAt, new Date(), refundPolicy, booking.currency as never);

      const seats = await this.bookings.loadSeats(bookingId);
      await this.seatLock.releaseOccupancy(booking.tripId, seats);
      await this.bookings.setStatus(bookingId, 'cancelled');
      const cancellationId = await this.bookings.recordCancellation({
        bookingId,
        reason: reason ?? null,
        refundPct: refund.refundPct,
        paidMinor: booking.paidMinor,
        feeMinor: refund.fee.minor,
        refundMinor: refund.refund.minor,
        cancelledBy: (getUserId() ?? null) as UserId | null,
      });

      this.metrics.bookings.inc({ outcome: 'cancelled', channel: 'direct' });
      this.events.publish({
        type: 'booking.cancelled',
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: {
          cancellationId, pnr: booking.pnr, customerId: booking.customerId, refundMinor: refund.refund.minor, refundPct: refund.refundPct,
          contactPhone: booking.contactPhone, contactEmail: booking.contactEmail,
          refundDestination, altAccountDetails: altAccountDetails ?? null,
        },
      });

      return { refundMinor: refund.refund.minor, refundPct: refund.refundPct };
    });
  }

  /**
   * Cancels ONLY the given seats out of a multi-seat booking — a family
   * booking 3 seats where one person drops out shouldn't have to cancel
   * (and rebook) all 3 just to release one. Each seat's refund is
   * computed off its OWN actual fare (booking_seats.fare_minor), not an
   * even split — a booking with a premium front-row seat and two regular
   * ones refunds each seat's real share, not a blended average.
   *
   * If every seat on the booking is named here, this is functionally a
   * full cancellation — delegated straight to cancel() rather than
   * duplicating that path, so the booking correctly ends up 'cancelled'
   * (not 'confirmed' with zero seats, which isCancellable() and every
   * other booking-state check would treat as invalid).
   */
  async cancelSeats(
    bookingId: BookingId, seatNumbers: string[], reason?: string,
    refundDestination: 'source' | 'alternate_account' = 'source',
    altAccountDetails?: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string },
  ): Promise<{ refundMinor: number; refundPct: number; remainingSeats: number }> {
    if (seatNumbers.length === 0) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'At least one seat must be specified' });
    }

    return this.uow.run({ name: 'booking.cancelSeats', tenantId: requireTenantId(), isolation: 'read committed' }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (!isCancellable(booking.status)) {
        throw new AppError(ErrorCode.BOOKING_NOT_CANCELLABLE, 422, { message: `A ${booking.status} booking cannot be cancelled` });
      }

      const trip = await this.trips.getById(booking.tripId);
      if (trip.departsAt < new Date()) {
        throw new AppError(ErrorCode.BOOKING_DEPARTED, 422, { message: 'Trip has already departed' });
      }

      const allSeats = await this.bookings.loadSeatsWithFare(bookingId);
      const requested = new Set(seatNumbers);
      const unknown = seatNumbers.filter((s) => !allSeats.some((seat) => seat.seatNumber === s));
      if (unknown.length > 0) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: `Seat(s) not on this booking: ${unknown.join(', ')}` });
      }

      // Naming every seat on the booking IS a full cancellation — go
      // through the real cancel() path so the booking ends up in the
      // correct terminal state, not a confusing "confirmed, 0 seats" one.
      if (requested.size === allSeats.length) {
        const full = await this.cancel(bookingId, reason, false, refundDestination, altAccountDetails);
        return { ...full, remainingSeats: 0 };
      }

      const toCancel = allSeats.filter((s) => requested.has(s.seatNumber));
      const toKeep = allSeats.filter((s) => !requested.has(s.seatNumber));

      // Each cancelled seat's OWN fare, proportioned against the booking's
      // ORIGINAL total to carve out its share of tax — never a flat
      // per-seat split, since fare_minor already reflects any per-seat
      // override (premium seats, segment-specific pricing).
      const originalFareTotal = allSeats.reduce((sum, s) => sum + s.fareMinor, 0);
      const cancelledFareMinor = toCancel.reduce((sum, s) => sum + s.fareMinor, 0);
      const cancelledTaxMinor = originalFareTotal > 0 ? Math.round((booking.taxMinor * cancelledFareMinor) / originalFareTotal) : 0;
      const cancelledPaidMinor = cancelledFareMinor + cancelledTaxMinor;

      const refundPolicy = await this.loadRefundPolicy();
      const refund = computeRefund(cancelledPaidMinor, trip.departsAt, new Date(), refundPolicy, booking.currency as never);

      await this.seatLock.releaseOccupancy(booking.tripId, toCancel.map((s) => ({ seatNumber: s.seatNumber, legMask: s.legMask })));
      await this.bookings.removeSeatsPartial(bookingId, seatNumbers);
      await this.bookings.reduceTotals(bookingId, cancelledFareMinor, cancelledTaxMinor, cancelledPaidMinor);
      const cancellationId = await this.bookings.recordCancellation({
        bookingId,
        reason: reason ? `${reason} (seats: ${seatNumbers.join(', ')})` : `Partial cancellation (seats: ${seatNumbers.join(', ')})`,
        refundPct: refund.refundPct,
        paidMinor: cancelledPaidMinor,
        feeMinor: refund.fee.minor,
        refundMinor: refund.refund.minor,
        cancelledBy: (getUserId() ?? null) as UserId | null,
      });

      this.metrics.bookings.inc({ outcome: 'partial_cancelled', channel: 'direct' });
      this.events.publish({
        type: 'booking.seats_cancelled',
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: {
          cancellationId, pnr: booking.pnr, seats: seatNumbers, refundMinor: refund.refund.minor, refundPct: refund.refundPct,
          remainingSeats: toKeep.length, contactPhone: booking.contactPhone, contactEmail: booking.contactEmail,
          refundDestination, altAccountDetails: altAccountDetails ?? null,
        },
      });

      return { refundMinor: refund.refund.minor, refundPct: refund.refundPct, remainingSeats: toKeep.length };
    });
  }

  /**
   * Insert with automatic PNR-collision retry.
   *
   * A unique-constraint violation aborts the whole Postgres transaction, so a
   * naive retry in the same transaction would fail. Each attempt therefore runs
   * inside a nested unit of work — a SAVEPOINT — so a collision rolls back only
   * that attempt, leaving the outer booking transaction intact. The unique index
   * on (tenant, pnr) is the real guarantee; this just makes the rare clash a
   * transparent retry rather than an error.
   */
  private async insertWithPnrRetry(
    insert: (pnr: string) => Promise<BookingId>,
    attempts = 5,
  ): Promise<{ bookingId: BookingId; pnr: string }> {
    for (let i = 0; i < attempts; i += 1) {
      const pnr = generatePnr();
      try {
        const bookingId = await this.uow.run({ name: 'booking.pnrAttempt', tenantId: requireTenantId() }, async () =>
          insert(pnr),
        );
        return { bookingId, pnr };
      } catch (error) {
        if (isUniqueViolation(error, 'bookings_tenant_id_pnr_key') && i < attempts - 1) {
          this.log.warn({ pnr }, 'PNR collision; regenerating');
          continue;
        }
        throw error;
      }
    }
    throw new AppError(ErrorCode.COMMON_INTERNAL, 500, { message: 'Could not allocate a unique PNR' });
  }
}

/** Domain validation failures become a clear 400 for the caller. */
function asHoldError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HoldValidationError) throw new AppError(ErrorCode.COMMON_VALIDATION, 400, { message: e.message });
    throw e;
  }
}

/** Every channel string maps to one of the controllable channel families. */
export function channelFamily(channel: string | undefined): 'direct_web' | 'agent' | 'ota' | 'phone' {
  if (channel === 'agent' || channel === 'phone' || channel === 'ota') return channel;
  if (channel?.startsWith('gds:') || channel === 'partner') return 'ota';
  return 'direct_web';
}
