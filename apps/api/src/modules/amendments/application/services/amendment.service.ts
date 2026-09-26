import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ErrorCode,
  getUserId,
  Money,
  newId,
  requireTenantId,
  type BookingId,
  type StopId,
  type TripId,
} from '@kernel';
import { EventBus } from '@messaging';

import { BookingRepository, SeatLockRepository, ticketCode } from '../../../booking';
import { RouteRepository } from '../../../master-data';
import { InventoryRepository, TripRepository } from '../../../scheduling';
import { PaymentService } from '../../../payment';
import { PricingService, FareRepository } from '../../../pricing';
import { quoteReschedule } from '../../domain/reschedule-policy';
import { planSeatChange, SeatChangeError } from '../../domain/seat-change';
import { PointChangeError, planPointChange, sameFare } from '../../domain/point-change';
import { checkNameCorrection } from '../../domain/name-correction';
import { AmendmentRepository } from '../../infrastructure/persistence/amendment.repository';

/**
 * ============================================================================
 *  Booking amendments — reschedule, seat-change, partial cancel
 * ============================================================================
 *
 * Each amendment is ONE unit of work that atomically releases the old seat
 * occupancy and acquires the new — reusing the exact same `SeatLockRepository`
 * gate as a fresh booking, so a reschedule can never double-sell the target
 * seat any more than a booking can. The money delta (fee + fare difference) is
 * computed by the pure policy and recorded on `booking_amendments` for audit.
 */
export interface RescheduleInput {
  bookingId: BookingId;
  newTripId: TripId;
  newFromStopId: StopId;
  newToStopId: StopId;
  newSeatNumbers: string[];
}

interface RescheduleMoney {
  feeMinor: number;
  fareDiffMinor: number;
  amountDueMinor: number;
  refundMinor: number;
}

/** What a reschedule payment carries until it is captured. */
export interface RescheduleMetadata extends RescheduleMoney {
  kind: 'reschedule';
  newTripId: string;
  newFromStopId: string;
  newToStopId: string;
  newSeatNumbers: string[];
  newTotalMinor: number;
}

export type RescheduleResult =
  | ({ status: 'rescheduled'; amendmentId: string } & RescheduleMoney)
  | ({
      status: 'payment_required';
      payment: { intentId: string; clientPayload: Record<string, unknown>; amountMinor: number };
    } & RescheduleMoney);

@Injectable()
export class AmendmentService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly seatLock: SeatLockRepository,
    private readonly inventory: InventoryRepository,
    private readonly trips: TripRepository,
    private readonly pricing: PricingService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly fares: FareRepository,
    private readonly routes: RouteRepository,
    private readonly amendments: AmendmentRepository,
    private readonly payments: PaymentService,
  ) {}

  /**
   * Reschedule a confirmed booking to another trip / segment / seats.
   *
   * Priced by quoteReschedule (fee + fare difference). When nothing is due,
   * the booking moves now and any refund due is paid by the refunds worker
   * (booking.rescheduled). When money is due, nothing moves yet: the result
   * carries a payment for exactly that amount, and the booking moves when the
   * payment is captured (RescheduleCapture) — at the price quoted now.
   */
  async reschedule(input: RescheduleInput): Promise<RescheduleResult> {
    return this.uow.run({ name: 'amend.reschedule', tenantId: requireTenantId() }, async () => {
      const booking = await this.bookings.findForUpdate(input.bookingId);
      if (!booking)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'confirmed') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'Only a confirmed booking can be rescheduled',
        });
      }
      const current = await this.bookings.loadSeats(input.bookingId);
      if (new Set(input.newSeatNumbers).size !== input.newSeatNumbers.length)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'A seat is listed twice' });
      if (input.newSeatNumbers.length !== current.length)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Pick ${current.length} seat(s) — one for each passenger`,
        });
      const oldTrip = await this.trips.getById(booking.tripId);
      const target = await this.resolveTarget(input);
      const quote = await this.pricing.quote({
        tripId: input.newTripId,
        fromStopId: input.newFromStopId,
        toStopId: input.newToStopId,
        seatType: 'seater',
        seatCount: input.newSeatNumbers.length,
      });
      const rq = quoteReschedule({
        originalFareMinor: booking.totalMinor,
        newFareMinor: quote.totalMinor,
        originalDepartureAt: oldTrip.departsAt,
        now: new Date(),
        timesRescheduled:
          (booking as unknown as { timesRescheduled?: number }).timesRescheduled ?? 0,
        currency: booking.currency as never,
      });
      if (!rq.allowed) {
        throw new AppError(ErrorCode.BOOKING_NOT_CANCELLABLE, 422, { message: rq.reason });
      }
      const money = {
        feeMinor: rq.feeMinor,
        fareDiffMinor: rq.fareDifferenceMinor,
        amountDueMinor: rq.amountDueMinor,
        refundMinor: rq.refundDueMinor,
      };

      if (rq.amountDueMinor > 0) {
        await this.assertSeatsFree(input, target);
        const metadata: RescheduleMetadata = {
          kind: 'reschedule',
          newTripId: input.newTripId,
          newFromStopId: input.newFromStopId,
          newToStopId: input.newToStopId,
          newSeatNumbers: input.newSeatNumbers,
          newTotalMinor: quote.totalMinor,
          ...money,
        };
        const payment = await this.payments.createAdjustmentPayment({
          bookingId: input.bookingId,
          amountMinor: rq.amountDueMinor,
          currency: booking.currency,
          metadata: { ...metadata },
        });
        return { status: 'payment_required', ...money, payment };
      }

      const amendmentId = await this.moveBooking(input, target, quote.totalMinor, money);
      return { status: 'rescheduled', ...money, amendmentId };
    });
  }

  /**
   * Complete a reschedule whose difference has been paid (called by
   * RescheduleCapture inside the capture transaction). Re-checks the booking
   * and the seats — they were not reserved while the customer paid.
   */
  async completePaidReschedule(bookingId: BookingId, m: RescheduleMetadata): Promise<void> {
    const booking = await this.bookings.findForUpdate(bookingId);
    if (!booking || booking.status !== 'confirmed')
      throw new Error(`Booking ${bookingId} can no longer be rescheduled`);
    const input: RescheduleInput = {
      bookingId,
      newTripId: m.newTripId as TripId,
      newFromStopId: m.newFromStopId as StopId,
      newToStopId: m.newToStopId as StopId,
      newSeatNumbers: m.newSeatNumbers,
    };
    const target = await this.resolveTarget(input);
    await this.moveBooking(input, target, m.newTotalMinor, {
      feeMinor: m.feeMinor,
      fareDiffMinor: m.fareDiffMinor,
      amountDueMinor: m.amountDueMinor,
      refundMinor: 0,
    });
  }

  /** The target trip must be open and the segment valid on it. */
  private async resolveTarget(input: RescheduleInput) {
    const trip = await this.trips.getById(input.newTripId);
    if (trip.status !== 'open') {
      throw new AppError(ErrorCode.INVENTORY_TRIP_CLOSED, 422, {
        message: 'Target trip is not open for booking',
      });
    }
    const seg = await this.inventory.resolveSegment(
      input.newTripId,
      input.newFromStopId,
      input.newToStopId,
    );
    if (!seg)
      throw new AppError(ErrorCode.INVENTORY_SEGMENT_INVALID, 422, {
        message: 'Invalid segment on the target trip',
      });
    return { trip, seg };
  }

  /** Fail before asking for money if a requested seat is already taken. */
  private async assertSeatsFree(
    input: RescheduleInput,
    target: Awaited<ReturnType<AmendmentService['resolveTarget']>>,
  ): Promise<void> {
    const seats = await this.inventory.seatAvailability(
      input.newTripId,
      target.seg.fromSeq,
      target.seg.toSeq,
    );
    const free = new Set(seats.filter((s) => s.available).map((s) => s.seatNumber));
    const taken = input.newSeatNumbers.filter((n) => !free.has(n));
    if (taken.length)
      throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 409, {
        message: `Seat(s) ${taken.join(', ')} are not available on that trip`,
      });
  }

  /**
   * Move the booking: lock + occupy the new seats (the same anti-double-sell
   * gate as a new booking), release the old, repoint the booking, record the
   * amendment, publish booking.rescheduled (the refunds worker pays any refund).
   */
  private async moveBooking(
    input: RescheduleInput,
    target: Awaited<ReturnType<AmendmentService['resolveTarget']>>,
    newTotalMinor: number,
    money: RescheduleMoney,
  ): Promise<string> {
    const booking = (await this.bookings.findForUpdate(input.bookingId))!;
    // Positional: old passenger i travels in new seat i, so the ladies-only
    // check sees who actually sits in each new seat.
    const oldPassengers = await this.bookings.loadPassengers(input.bookingId);
    const genderBySeat: Record<string, string | undefined> = {};
    input.newSeatNumbers.forEach((seatNumber, i) => {
      genderBySeat[seatNumber] = oldPassengers[i]?.gender ?? undefined;
    });
    const newLocked = await this.seatLock.lockSeats({
      tripId: input.newTripId,
      seatNumbers: input.newSeatNumbers,
      fromSeq: target.seg.fromSeq,
      toSeq: target.seg.toSeq,
      stopCount: target.trip.stopCount,
      passengerGenderBySeat: genderBySeat,
    });
    await this.seatLock.commitOccupancy(input.newTripId, newLocked);
    await this.seatLock.releaseOccupancy(
      booking.tripId,
      await this.bookings.loadSeats(input.bookingId),
    );

    // The new total split over the seats exactly (remainder to the first
    // seats), so a later partial cancel refunds precisely what was paid.
    const seatFares = Money.of(newTotalMinor).allocate(newLocked.length);
    // Passenger i (and their ticket) goes to new seat i.
    const moves = oldPassengers.map((p, i) => ({
      from: p.seatNumber,
      to: input.newSeatNumbers[i],
    }));
    await this.bookings.moveToTrip({
      moves,
      codes: moves.map((m) => ticketCode(booking.pnr, m.to)),
      bookingId: input.bookingId,
      tripId: input.newTripId,
      fromSeq: target.seg.fromSeq,
      toSeq: target.seg.toSeq,
      fromStopId: input.newFromStopId,
      toStopId: input.newToStopId,
      totalMinor: newTotalMinor,
      seats: newLocked.map((l, i) => ({ ...l, fareMinor: seatFares[i].minor })),
    });
    const amendmentId = newId();
    await this.amendments.record({
      id: amendmentId,
      tenantId: requireTenantId(),
      bookingId: input.bookingId,
      kind: 'reschedule',
      newTripId: input.newTripId,
      detail: { from: booking.tripId, seats: input.newSeatNumbers },
      performedBy: getUserId() ?? null,
      money,
    });
    this.events.publish({
      type: 'booking.rescheduled',
      aggregateType: 'booking',
      aggregateId: input.bookingId,
      payload: {
        newTripId: input.newTripId,
        amountDue: money.amountDueMinor,
        refund: money.refundMinor,
      },
    });
    return amendmentId;
  }

  /**
   * Change seats within the SAME trip (e.g. window instead of aisle).
   * See domain/seat-change.ts for who moves where. Order inside ONE
   * transaction (booking row locked): release the seats being given up →
   * lock + occupy the new ones → rewrite booking_seats, passengers and
   * tickets. Any failure rolls everything back, so the old seats are never lost.
   */
  async changeSeats(
    bookingId: BookingId,
    newSeatNumbers: string[],
  ): Promise<{ amendmentId: string }> {
    return this.uow.run({ name: 'amend.seatChange', tenantId: requireTenantId() }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'confirmed') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'Only a confirmed booking can change seats',
        });
      }
      const trip = await this.trips.getById(booking.tripId);
      const current = await this.bookings.loadSeatsWithFare(bookingId);
      let plan: ReturnType<typeof planSeatChange>;
      try {
        plan = planSeatChange(current, newSeatNumbers);
      } catch (e) {
        if (e instanceof SeatChangeError)
          throw new AppError(ErrorCode.COMMON_VALIDATION, 400, { message: e.message });
        throw e;
      }

      const passengers = await this.bookings.loadPassengers(bookingId);
      const genderBySeat: Record<string, string | undefined> = {};
      for (const m of plan.moves)
        genderBySeat[m.to] = passengers.find((p) => p.seatNumber === m.from)?.gender ?? undefined;

      // 1. give up the old seats first — otherwise an overlapping change
      //    (1A,1B → 1B,1C) could never pass the availability check.
      const givingUp = current.filter((c) => plan.moves.some((m) => m.from === c.seatNumber));
      await this.seatLock.releaseOccupancy(booking.tripId, givingUp);
      // 2. lock + occupy the new seats (same anti-double-sell gate as a new booking).
      const newLocked = await this.seatLock.lockSeats({
        tripId: booking.tripId,
        seatNumbers: plan.moves.map((m) => m.to),
        fromSeq: booking.fromSeq,
        toSeq: booking.toSeq,
        stopCount: trip.stopCount,
        passengerGenderBySeat: genderBySeat,
      });
      await this.seatLock.commitOccupancy(booking.tripId, newLocked);

      // 3. rewrite the booking's own records. Fares travel with passengers.
      const tenantId = requireTenantId();
      const from = plan.moves.map((m) => m.from);
      const to = plan.moves.map((m) => m.to);
      const maskByTo = new Map(newLocked.map((l) => [l.seatNumber, l.legMask.toString()]));
      await this.bookings.moveSeats({
        bookingId,
        tripId: booking.tripId,
        from,
        to,
        legMasks: to.map((t) => maskByTo.get(t)!),
        fares: plan.moves.map((m) => m.fareMinor),
        codes: to.map((t) => ticketCode(booking.pnr, t)),
      });

      const amendmentId = newId();
      await this.amendments.record({
        id: amendmentId,
        tenantId,
        bookingId,
        kind: 'seat_change',
        detail: { moves: plan.moves, kept: plan.kept },
        performedBy: getUserId() ?? null,
      });
      return { amendmentId };
    });
  }

  /**
   * Change the boarding and/or dropping point on the SAME trip for all seats
   * of a confirmed booking (see domain/point-change.ts for the rules). One
   * transaction, booking row locked: release the old legs → lock + occupy the
   * new legs (same anti-double-sell gate as a new sale, incl. other customers'
   * live holds) → update booking + seat leg masks → audit. Any failure rolls
   * everything back, so the passenger never loses the seat.
   */
  async changePoints(
    bookingId: BookingId,
    input: { fromStopId?: string; toStopId?: string },
  ): Promise<{ amendmentId: string; fromStopId: string; toStopId: string }> {
    if (!input.fromStopId && !input.toStopId)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 400, {
        message: 'Choose a new boarding and/or dropping point',
      });
    return this.uow.run({ name: 'amend.pointChange', tenantId: requireTenantId() }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'confirmed')
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'Only a confirmed booking can change its boarding or dropping point',
        });
      const trip = await this.trips.getById(booking.tripId);
      if (!['scheduled', 'open'].includes(trip.status))
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: `The trip is ${trip.status}`,
        });

      const stops = await this.routes.stopRules(trip.routeId);
      let plan: ReturnType<typeof planPointChange>;
      try {
        plan = planPointChange({
          stops,
          current: { fromSeq: booking.fromSeq, toSeq: booking.toSeq },
          newFromStopId: input.fromStopId,
          newToStopId: input.toStopId,
          tripDepartsAt: trip.departsAt,
        });
      } catch (e) {
        if (e instanceof PointChangeError)
          throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
        throw e;
      }

      // Money: only within the same fare stage (per seat type on the booking).
      const seats = await this.bookings.loadSeatsWithFare(bookingId);
      const types = await this.inventory.seatTypes(
        booking.tripId,
        seats.map((s) => s.seatNumber),
      );
      const seatTypes = [
        ...new Set(seats.map((s) => types.get(s.seatNumber)?.seatType ?? 'seater')),
      ];
      const oldFrom = stops.find((s) => s.sequence === booking.fromSeq)!.stopId;
      const oldTo = stops.find((s) => s.sequence === booking.toSeq)!.stopId;
      const fareFor = (from: string, to: string, seatType: string) =>
        this.fares
          .resolveFare({
            routeId: trip.routeId,
            fromStopId: from as StopId,
            toStopId: to as StopId,
            seatType,
            distanceM: 0,
            journeyDate: trip.journeyDate,
          })
          .then((f) => f?.baseFareMinor ?? null);
      const [oldFares, newFares] = await Promise.all([
        Promise.all(seatTypes.map((t) => fareFor(oldFrom, oldTo, t))),
        Promise.all(seatTypes.map((t) => fareFor(plan.fromStopId, plan.toStopId, t))),
      ]);
      if (!sameFare(oldFares, newFares)) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message:
            'The fare is different for that boarding/dropping point — use "Change date/trip" (reschedule) so the difference can be paid or refunded',
          details: { oldFares, newFares, seatTypes },
        });
      }

      // Seats: free the old legs, then take the new ones through the normal gate.
      const passengers = await this.bookings.loadPassengers(bookingId);
      const genderBySeat = Object.fromEntries(
        passengers.map((p) => [p.seatNumber, p.gender ?? undefined]),
      );
      const current = await this.bookings.loadSeats(bookingId);
      await this.seatLock.releaseOccupancy(booking.tripId, current);
      const locked = await this.seatLock.lockSeats({
        tripId: booking.tripId,
        seatNumbers: current.map((r) => r.seatNumber),
        fromSeq: plan.fromSeq,
        toSeq: plan.toSeq,
        stopCount: trip.stopCount,
        passengerGenderBySeat: genderBySeat,
      });
      await this.seatLock.commitOccupancy(booking.tripId, locked);

      await this.bookings.changeSegment({
        bookingId,
        fromSeq: plan.fromSeq,
        toSeq: plan.toSeq,
        fromStopId: plan.fromStopId,
        toStopId: plan.toStopId,
        seats: locked,
      });
      const amendmentId = newId();
      await this.amendments.record({
        id: amendmentId,
        tenantId: requireTenantId(),
        bookingId,
        kind: 'point_change',
        detail: {
          from: { stopId: oldFrom, seq: booking.fromSeq },
          to: { stopId: oldTo, seq: booking.toSeq },
          newFrom: plan.fromStopId,
          newTo: plan.toStopId,
        },
        performedBy: getUserId() ?? null,
      });
      this.events.publish({
        type: 'booking.points_changed',
        aggregateType: 'booking',
        aggregateId: bookingId,
        payload: {
          pnr: booking.pnr,
          fromStopId: plan.fromStopId,
          toStopId: plan.toStopId,
          contactPhone: booking.contactPhone ?? null,
        },
      });
      return { amendmentId, fromStopId: plan.fromStopId, toStopId: plan.toStopId };
    });
  }

  /** Correct a passenger's name spelling (510) — never a transfer; see domain/name-correction.ts. */
  async correctName(
    bookingId: BookingId,
    seatNumber: string,
    newName: string,
  ): Promise<{ amendmentId: string }> {
    return this.uow.run({ name: 'amend.nameCorrection', tenantId: requireTenantId() }, async () => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (!['confirmed', 'held'].includes(booking.status))
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: `The booking is ${booking.status}`,
        });
      const seat = seatNumber.trim();
      const pax = (await this.bookings.loadPassengers(bookingId)).find(
        (p) => p.seatNumber === seat,
      );
      if (!pax)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: `No passenger on seat ${seat} in this booking`,
        });
      const trip = await this.trips.getById(booking.tripId);
      const off =
        (await this.routes.stopRules(trip.routeId)).find((r) => r.sequence === booking.fromSeq)
          ?.departOffsetMin ?? 0;
      const previous = await this.amendments.countNameCorrections(bookingId, seat);
      const problem = checkNameCorrection({
        oldName: pax.fullName,
        newName,
        previousCorrections: previous,
        boardingAt: new Date(trip.departsAt.getTime() + off * 60_000),
      });
      if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
      const clean = newName.trim().replace(/\s+/g, ' ');
      await this.bookings.renamePassenger(bookingId, seat, clean);
      const amendmentId = newId();
      await this.amendments.record({
        id: amendmentId,
        tenantId: requireTenantId(),
        bookingId,
        kind: 'name_correction',
        detail: { seat, from: pax.fullName, to: clean },
        performedBy: getUserId() ?? null,
      });
      return { amendmentId };
    });
  }
}
