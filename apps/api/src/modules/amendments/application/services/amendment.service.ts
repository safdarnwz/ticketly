import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError, ErrorCode, getUserId, newId, requireTenantId,
  type BookingId, type StopId, type TripId,
} from '@kernel';
import { EventBus } from '@messaging';

import { BookingRepository } from '../../../booking/infrastructure/persistence/booking.repository';
import { SeatLockRepository } from '../../../booking/infrastructure/persistence/seat-lock.repository';
import { InventoryRepository } from '../../../scheduling/infrastructure/persistence/inventory.repository';
import { TripRepository } from '../../../scheduling/infrastructure/persistence/trip.repository';
import { PricingService } from '../../../pricing/application/services/pricing.service';
import { quoteReschedule } from '../../domain/reschedule-policy';
import { planSeatChange, SeatChangeError } from '../../domain/seat-change';
import { PointChangeError, planPointChange, sameFare } from '../../domain/point-change';
import { checkNameCorrection } from '../../domain/name-correction';
import { FareRepository } from '../../../pricing/infrastructure/persistence/fare.repository';
import { ticketCode } from '../../../booking/domain/pnr';

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
  ) {}

  /**
   * Reschedule a confirmed booking to a new trip. Locks the new seats, releases
   * the old, records the money delta. The passenger pays `amountDue` (Part 8
   * intent) or is refunded `refund` (Part 8) out of band; this moves the seats.
   */
  async reschedule(input: {
    bookingId: BookingId;
    newTripId: TripId;
    newFromStopId: StopId;
    newToStopId: StopId;
    newSeatNumbers: string[];
  }): Promise<{ amountDueMinor: number; refundMinor: number; feeMinor: number; amendmentId: string }> {
    return this.uow.run({ name: 'amend.reschedule', tenantId: requireTenantId() }, async () => {
      const booking = await this.bookings.findForUpdate(input.bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'confirmed') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: 'Only a confirmed booking can be rescheduled' });
      }

      const oldTrip = await this.trips.getById(booking.tripId);
      const newTrip = await this.trips.getById(input.newTripId);
      if (newTrip.status !== 'open') {
        throw new AppError(ErrorCode.INVENTORY_TRIP_CLOSED, 422, { message: 'Target trip is not open for booking' });
      }

      // Price the new trip's segment for the same seat count.
      const seg = await this.inventory.resolveSegment(input.newTripId, input.newFromStopId, input.newToStopId);
      if (!seg) throw new AppError(ErrorCode.INVENTORY_SEGMENT_INVALID, 422, { message: 'Invalid segment on the target trip' });

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
        timesRescheduled: (booking as unknown as { timesRescheduled?: number }).timesRescheduled ?? 0,
        currency: booking.currency as never,
      });
      if (!rq.allowed) {
        throw new AppError(ErrorCode.BOOKING_NOT_CANCELLABLE, 422, { message: rq.reason });
      }
      // A fare INCREASE needs to actually be COLLECTED from the customer —
      // there is no saved card/UPI to auto-charge, and this is a background-
      // safe seat-repoint, not an interactive checkout. Until a proper
      // synchronous "pay the difference, then repoint" flow exists (the
      // same shape as seat-upgrade's captureIncrementalPayment), blocking
      // this outright is the safe choice: the alternative — silently
      // repointing to the pricier trip without collecting anything — was a
      // genuine revenue leak (this repo's #16). Cancelling and rebooking
      // fresh already goes through the real payment flow correctly.
      if (rq.amountDueMinor > 0) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `This reschedule would cost ${rq.amountDueMinor} more, which isn't collectable through reschedule yet — please cancel and book the new trip instead.`,
        });
      }

      // Lock the NEW seats (the same anti-double-sell gate). Positional
      // correspondence with the existing passengers — reschedule/seat-change
      // preserve WHO is travelling, just WHICH seat they're in, so old-seat
      // index i's passenger becomes new-seat index i's passenger. Needed so
      // a genuine female passenger rebooked into another ladies-only seat
      // isn't wrongly rejected by seat-lock's per-seat gender check (which
      // has no other way to know who's actually going into the new seat).
      const oldPassengers = await this.bookings.loadPassengers(input.bookingId);
      const genderBySeat: Record<string, string | undefined> = {};
      input.newSeatNumbers.forEach((seatNumber: string, i: number) => {
        genderBySeat[seatNumber] = oldPassengers[i]?.gender ?? undefined;
      });
      const newLocked = await this.seatLock.lockSeats({
        tripId: input.newTripId,
        seatNumbers: input.newSeatNumbers,
        fromSeq: seg.fromSeq,
        toSeq: seg.toSeq,
        stopCount: newTrip.stopCount,
        passengerGenderBySeat: genderBySeat,
      });
      await this.seatLock.commitOccupancy(input.newTripId, newLocked);

      // Release the OLD seats.
      const oldSeats = await this.bookings.loadSeats(input.bookingId);
      await this.seatLock.releaseOccupancy(booking.tripId, oldSeats);

      // Repoint the booking to the new trip/seats and bump the reschedule count.
      const amendmentId = newId();
      await this.uow.run({ name: 'amend.repoint', tenantId: requireTenantId() }, async (scope) => {
        await scope.client.query(
          `UPDATE bookings SET trip_id = $2, from_seq = $3, to_seq = $4, from_stop_id = $5, to_stop_id = $6,
                  total_minor = $7, times_rescheduled = times_rescheduled + 1, updated_at = now()
            WHERE tenant_id = $1 AND id = $8`,
          [requireTenantId(), input.newTripId, seg.fromSeq, seg.toSeq, input.newFromStopId, input.newToStopId, quote.totalMinor, input.bookingId],
        );
        await scope.client.query(`DELETE FROM booking_seats WHERE booking_id = $1`, [input.bookingId]);
        for (const s of newLocked) {
          await scope.client.query(
            `INSERT INTO booking_seats (booking_id, tenant_id, trip_id, seat_number, leg_mask, fare_minor)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [input.bookingId, requireTenantId(), input.newTripId, s.seatNumber, s.legMask.toString(), Math.floor(quote.totalMinor / newLocked.length)],
          );
        }
        await scope.client.query(
          `INSERT INTO booking_amendments (id, tenant_id, booking_id, kind, new_trip_id, detail, fee_minor, fare_diff_minor, amount_due_minor, refund_minor, performed_by)
           VALUES ($1,$2,$3,'reschedule',$4,$5,$6,$7,$8,$9,$10)`,
          [amendmentId, requireTenantId(), input.bookingId, input.newTripId,
           JSON.stringify({ from: booking.tripId, seats: input.newSeatNumbers }),
           rq.feeMinor, rq.fareDifferenceMinor, rq.amountDueMinor, rq.refundDueMinor, getUserId() ?? null],
        );
      });

      this.events.publish({
        type: 'booking.rescheduled',
        aggregateType: 'booking',
        aggregateId: input.bookingId,
        payload: { newTripId: input.newTripId, amountDue: rq.amountDueMinor, refund: rq.refundDueMinor },
      });

      return { amountDueMinor: rq.amountDueMinor, refundMinor: rq.refundDueMinor, feeMinor: rq.feeMinor, amendmentId };
    });
  }

  /**
   * Change seats within the SAME trip (e.g. window instead of aisle).
   * See domain/seat-change.ts for who moves where. Order inside ONE
   * transaction (booking row locked): release the seats being given up →
   * lock + occupy the new ones → rewrite booking_seats, passengers and
   * tickets. Any failure rolls everything back, so the old seats are never lost.
   */
  async changeSeats(bookingId: BookingId, newSeatNumbers: string[]): Promise<{ amendmentId: string }> {
    return this.uow.run({ name: 'amend.seatChange', tenantId: requireTenantId() }, async (scope) => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'confirmed') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: 'Only a confirmed booking can change seats' });
      }
      const trip = await this.trips.getById(booking.tripId);
      const current = await this.bookings.loadSeatsWithFare(bookingId);
      let plan: ReturnType<typeof planSeatChange>;
      try {
        plan = planSeatChange(current, newSeatNumbers);
      } catch (e) {
        if (e instanceof SeatChangeError) throw new AppError(ErrorCode.COMMON_VALIDATION, 400, { message: e.message });
        throw e;
      }

      const passengers = await this.bookings.loadPassengers(bookingId);
      const genderBySeat: Record<string, string | undefined> = {};
      for (const m of plan.moves) genderBySeat[m.to] = passengers.find((p) => p.seatNumber === m.from)?.gender ?? undefined;

      // 1. give up the old seats first — otherwise an overlapping change
      //    (1A,1B → 1B,1C) could never pass the availability check.
      const givingUp = current.filter((c) => plan.moves.some((m) => m.from === c.seatNumber));
      await this.seatLock.releaseOccupancy(booking.tripId, givingUp);
      // 2. lock + occupy the new seats (same anti-double-sell gate as a new booking).
      const newLocked = await this.seatLock.lockSeats({
        tripId: booking.tripId, seatNumbers: plan.moves.map((m) => m.to), fromSeq: booking.fromSeq, toSeq: booking.toSeq,
        stopCount: trip.stopCount, passengerGenderBySeat: genderBySeat,
      });
      await this.seatLock.commitOccupancy(booking.tripId, newLocked);

      // 3. rewrite the booking's own records. Fares travel with passengers.
      const tenantId = requireTenantId();
      const from = plan.moves.map((m) => m.from);
      const to = plan.moves.map((m) => m.to);
      const maskByTo = new Map(newLocked.map((l) => [l.seatNumber, l.legMask.toString()]));
      await scope.client.query(`DELETE FROM booking_seats WHERE booking_id = $1 AND seat_number = ANY($2::text[])`, [bookingId, from]);
      await scope.client.query(
        `INSERT INTO booking_seats (booking_id, tenant_id, trip_id, seat_number, leg_mask, fare_minor)
         SELECT $1, $2, $3, u.seat_number, u.leg_mask, u.fare_minor
           FROM unnest($4::text[], $5::bigint[], $6::bigint[]) AS u(seat_number, leg_mask, fare_minor)`,
        [bookingId, tenantId, booking.tripId, to, to.map((t) => maskByTo.get(t)), plan.moves.map((m) => m.fareMinor)],
      );
      await scope.client.query(
        `UPDATE passengers p SET seat_number = u.to_seat
           FROM unnest($2::text[], $3::text[]) AS u(from_seat, to_seat)
          WHERE p.booking_id = $1 AND p.seat_number = u.from_seat`,
        [bookingId, from, to],
      );
      // Tickets: boarding codes are unique and derived from the seat, so move
      // them in two steps — a swap can never collide mid-statement.
      await scope.client.query(
        `UPDATE tickets SET boarding_code = boarding_code || ':' || id WHERE booking_id = $1 AND seat_number = ANY($2::text[])`,
        [bookingId, from],
      );
      await scope.client.query(
        `UPDATE tickets t SET seat_number = u.to_seat, boarding_code = u.code
           FROM unnest($2::text[], $3::text[], $4::text[]) AS u(from_seat, to_seat, code)
          WHERE t.booking_id = $1 AND t.seat_number = u.from_seat`,
        [bookingId, from, to, to.map((t) => ticketCode(booking.pnr, t))],
      );

      const amendmentId = newId();
      await scope.client.query(
        `INSERT INTO booking_amendments (id, tenant_id, booking_id, kind, detail, performed_by)
         VALUES ($1,$2,$3,'seat_change',$4,$5)`,
        [amendmentId, tenantId, bookingId, JSON.stringify({ moves: plan.moves, kept: plan.kept }), getUserId() ?? null],
      );
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
  async changePoints(bookingId: BookingId, input: { fromStopId?: string; toStopId?: string }): Promise<{ amendmentId: string; fromStopId: string; toStopId: string }> {
    if (!input.fromStopId && !input.toStopId) throw new AppError(ErrorCode.COMMON_VALIDATION, 400, { message: 'Choose a new boarding and/or dropping point' });
    return this.uow.run({ name: 'amend.pointChange', tenantId: requireTenantId() }, async (scope) => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (booking.status !== 'confirmed') throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: 'Only a confirmed booking can change its boarding or dropping point' });
      const trip = await this.trips.getById(booking.tripId);
      if (!['scheduled', 'open'].includes(trip.status)) throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: `The trip is ${trip.status}` });

      const stops = (await scope.client.query<{ stop_id: string; sequence: number; depart_offset_min: number; can_board: boolean; can_alight: boolean }>(
        `SELECT stop_id, sequence, depart_offset_min, can_board, can_alight FROM route_stops WHERE route_id = $1 ORDER BY sequence`, [trip.routeId])).rows
        .map((r) => ({ stopId: r.stop_id, sequence: r.sequence, departOffsetMin: r.depart_offset_min, canBoard: r.can_board, canAlight: r.can_alight }));
      let plan: ReturnType<typeof planPointChange>;
      try {
        plan = planPointChange({ stops, current: { fromSeq: booking.fromSeq, toSeq: booking.toSeq }, newFromStopId: input.fromStopId, newToStopId: input.toStopId, tripDepartsAt: trip.departsAt });
      } catch (e) {
        if (e instanceof PointChangeError) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
        throw e;
      }

      // Money: only within the same fare stage (per seat type on the booking).
      const seats = await this.bookings.loadSeatsWithFare(bookingId);
      const types = await this.inventory.seatTypes(booking.tripId, seats.map((s) => s.seatNumber));
      const seatTypes = [...new Set(seats.map((s) => types.get(s.seatNumber)?.seatType ?? 'seater'))];
      const oldFrom = stops.find((s) => s.sequence === booking.fromSeq)!.stopId;
      const oldTo = stops.find((s) => s.sequence === booking.toSeq)!.stopId;
      const fareFor = (from: string, to: string, seatType: string) => this.fares.resolveFare({ routeId: trip.routeId, fromStopId: from as StopId, toStopId: to as StopId, seatType, distanceM: 0, journeyDate: trip.journeyDate }).then((f) => f?.baseFareMinor ?? null);
      const [oldFares, newFares] = await Promise.all([
        Promise.all(seatTypes.map((t) => fareFor(oldFrom, oldTo, t))),
        Promise.all(seatTypes.map((t) => fareFor(plan.fromStopId, plan.toStopId, t))),
      ]);
      if (!sameFare(oldFares, newFares)) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: 'The fare is different for that boarding/dropping point — use "Change date/trip" (reschedule) so the difference can be paid or refunded',
          details: { oldFares, newFares, seatTypes },
        });
      }

      // Seats: free the old legs, then take the new ones through the normal gate.
      const passengers = await this.bookings.loadPassengers(bookingId);
      const genderBySeat = Object.fromEntries(passengers.map((p) => [p.seatNumber, p.gender ?? undefined]));
      const current = await scope.client.query<{ seat_number: string; leg_mask: string }>(`SELECT seat_number, leg_mask FROM booking_seats WHERE booking_id = $1`, [bookingId]);
      await this.seatLock.releaseOccupancy(booking.tripId, current.rows.map((r) => ({ seatNumber: r.seat_number, legMask: BigInt(r.leg_mask) })));
      const locked = await this.seatLock.lockSeats({
        tripId: booking.tripId, seatNumbers: current.rows.map((r) => r.seat_number), fromSeq: plan.fromSeq, toSeq: plan.toSeq,
        stopCount: trip.stopCount, passengerGenderBySeat: genderBySeat,
      });
      await this.seatLock.commitOccupancy(booking.tripId, locked);

      const tenantId = requireTenantId();
      await scope.client.query(
        `UPDATE bookings SET from_seq = $3, to_seq = $4, from_stop_id = $5, to_stop_id = $6, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, bookingId, plan.fromSeq, plan.toSeq, plan.fromStopId, plan.toStopId]);
      await scope.client.query(
        `UPDATE booking_seats bs SET leg_mask = u.mask FROM unnest($2::text[], $3::bigint[]) AS u(seat, mask) WHERE bs.booking_id = $1 AND bs.seat_number = u.seat`,
        [bookingId, locked.map((l) => l.seatNumber), locked.map((l) => l.legMask.toString())]);
      const amendmentId = newId();
      await scope.client.query(
        `INSERT INTO booking_amendments (id, tenant_id, booking_id, kind, detail, performed_by) VALUES ($1,$2,$3,'point_change',$4,$5)`,
        [amendmentId, tenantId, bookingId, JSON.stringify({ from: { stopId: oldFrom, seq: booking.fromSeq }, to: { stopId: oldTo, seq: booking.toSeq }, newFrom: plan.fromStopId, newTo: plan.toStopId }), getUserId() ?? null]);
      this.events.publish({ type: 'booking.points_changed', aggregateType: 'booking', aggregateId: bookingId, payload: { pnr: booking.pnr, fromStopId: plan.fromStopId, toStopId: plan.toStopId, contactPhone: booking.contactPhone ?? null } });
      return { amendmentId, fromStopId: plan.fromStopId, toStopId: plan.toStopId };
    });
  }

  /** Correct a passenger's name spelling (510) — never a transfer; see domain/name-correction.ts. */
  async correctName(bookingId: BookingId, seatNumber: string, newName: string): Promise<{ amendmentId: string }> {
    return this.uow.run({ name: 'amend.nameCorrection', tenantId: requireTenantId() }, async (scope) => {
      const booking = await this.bookings.findForUpdate(bookingId);
      if (!booking) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Booking not found' });
      if (!['confirmed', 'held'].includes(booking.status)) throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, { message: `The booking is ${booking.status}` });
      const seat = seatNumber.trim();
      const pax = (await this.bookings.loadPassengers(bookingId)).find((p) => p.seatNumber === seat);
      if (!pax) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: `No passenger on seat ${seat} in this booking` });
      const trip = await this.trips.getById(booking.tripId);
      const off = (await scope.client.query<{ depart_offset_min: number }>(`SELECT depart_offset_min FROM route_stops WHERE route_id = $1 AND sequence = $2`, [trip.routeId, booking.fromSeq])).rows[0]?.depart_offset_min ?? 0;
      const previous = Number((await scope.client.query<{ n: string }>(
        `SELECT count(*) AS n FROM booking_amendments WHERE booking_id = $1 AND kind = 'name_correction' AND detail->>'seat' = $2`, [bookingId, seat])).rows[0]?.n ?? 0);
      const problem = checkNameCorrection({ oldName: pax.fullName, newName, previousCorrections: previous, boardingAt: new Date(trip.departsAt.getTime() + off * 60_000) });
      if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
      const clean = newName.trim().replace(/\s+/g, ' ');
      await scope.client.query(`UPDATE passengers SET full_name = $3 WHERE booking_id = $1 AND seat_number = $2`, [bookingId, seat, clean]);
      const amendmentId = newId();
      await scope.client.query(
        `INSERT INTO booking_amendments (id, tenant_id, booking_id, kind, detail, performed_by) VALUES ($1,$2,$3,'name_correction',$4,$5)`,
        [amendmentId, requireTenantId(), bookingId, JSON.stringify({ seat, from: pax.fullName, to: clean }), getUserId() ?? null]);
      return { amendmentId };
    });
  }
}
