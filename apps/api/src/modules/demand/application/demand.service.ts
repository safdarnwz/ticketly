import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { registerConstraintMessages, UnitOfWork } from '@database';
import { AppError, ErrorCode, mapWithConcurrency, newId, requireTenantId, type TripId } from '@kernel';
import { EventBus } from '@messaging';

import { forecastOccupancy, type Forecast } from '../domain/occupancy-forecast';
import { DemandRepository } from '../infrastructure/demand.repository';
import { WaitlistRuleError, pickToNotify, validateJoin } from '../domain/waitlist-rules';

registerConstraintMessages({ trip_waitlist_one_live_uq: 'This phone number is already on the waitlist for this trip' });

@Injectable()
export class DemandService {
  constructor(private readonly uow: UnitOfWork, private readonly events: EventBus, private readonly config: AppConfig, private readonly repo: DemandRepository) {}

  /* ───────────── waitlist ───────────── */

  async joinWaitlist(tripId: TripId, input: { fromStopId: string; toStopId: string; seatCount: number; contactPhone: string; contactEmail?: string; customerId?: string | null }) {
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'waitlist.join', tenantId }, async () => {
      const trip = await this.repo.lockTrip(tripId);
      if (!trip) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
      const seqs = await this.repo.stopSequences(trip.route_id, [input.fromStopId, input.toStopId]);
      const from = seqs.find((s) => s.stop_id === input.fromStopId)?.sequence;
      const to = seqs.find((s) => s.stop_id === input.toStopId)?.sequence;
      if (from === undefined || to === undefined || to <= from) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Those stops are not a valid journey on this trip' });
      const available = await this.repo.availableSeats(tripId, from, to);
      const waiting = await this.repo.waitingCount(tripId);
      try {
        validateJoin({ seatCount: input.seatCount, availableSeats: available, tripStatus: trip.status, departsAt: trip.departs_at, waitingCount: waiting });
      } catch (e) {
        if (e instanceof WaitlistRuleError) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
        throw e;
      }
      const id = newId();
      await this.repo.insertEntry({ id, tripId, fromStopId: input.fromStopId, toStopId: input.toStopId, fromSeq: from, toSeq: to, seatCount: input.seatCount,
        contactPhone: input.contactPhone.trim(), contactEmail: input.contactEmail?.trim() || null, customerId: input.customerId ?? null });
      return { waitlistId: id, position: waiting + 1 };
    });
  }

  /** Leave: the phone number must match (a guessed id alone cannot remove someone else). */
  async leaveWaitlist(tripId: TripId, waitlistId: string, contactPhone: string) {
    return this.uow.run({ name: 'waitlist.leave', tenantId: requireTenantId() }, async () => {
      const n = await this.repo.cancelEntry(tripId, waitlistId, contactPhone.trim());
      if (n === 0) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'No active waitlist entry found for that phone number' });
      return { ok: true };
    });
  }

  listWaitlist(tripId: TripId) {
    return this.repo.listEntries(tripId);
  }


  /**
   * Seats were freed on a trip: notify waiting entries oldest-first, only as
   * many as the free seats can satisfy. Entries are row-locked (SKIP LOCKED)
   * so two concurrent cancellations never notify the same person twice; the
   * event + 'notified' status are written in the same transaction.
   */
  async onSeatsFreed(tripId: TripId): Promise<number> {
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'waitlist.notify', tenantId }, async () => {
      const trip = await this.repo.tripForNotify(tripId);
      if (!trip) return 0;
      if (!['scheduled', 'open'].includes(trip.status) || trip.departs_at.getTime() - Date.now() < 60 * 60_000) {
        await this.repo.expireWaiting(tripId);
        return 0;
      }
      const entries = await this.repo.lockWaiting(tripId);
      if (!entries.length) return 0;
      const avail = new Map<string, number>();
      for (const e of entries) {
        const k = `${e.from_seq}-${e.to_seq}`;
        if (!avail.has(k)) avail.set(k, await this.repo.availableSeats(tripId, e.from_seq, e.to_seq));
      }
      const pick = new Set(pickToNotify(entries.map((e) => ({ id: e.id, seatCount: e.seat_count, availableForSegment: avail.get(`${e.from_seq}-${e.to_seq}`) ?? 0 }))));
      if (!pick.size) return 0;
      await this.repo.markNotified([...pick]);
      const bookUrl = `${this.config.app.publicBaseUrl}/trips/${tripId}`;
      for (const e of entries.filter((x) => pick.has(x.id))) {
        this.events.publish({
          type: 'waitlist.seats_available', aggregateType: 'trip', aggregateId: tripId,
          payload: { contactPhone: e.contact_phone, contactEmail: e.contact_email, seatCount: e.seat_count, routeName: trip.route_name, journeyDate: trip.journey_date, bookUrl },
        });
      }
      return pick.size;
    });
  }

  /* ───────────── occupancy forecast ───────────── */

  /**
   * Forecast final occupancy from the booking pace of the same service's
   * trips in the last 8 weeks (one query for all history).
   */
  async forecast(tripId: TripId): Promise<Forecast & { tripId: string; currentSold: number; totalSeats: number; daysToDeparture: number }> {
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'demand.forecast', tenantId, readOnly: true }, async () => {
      const t = await this.repo.tripForForecast(tripId);
      if (!t) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
      const leadDays = Math.max(0, Math.ceil((t.departs_at.getTime() - Date.now()) / 86_400_000));
      const [current, history] = await Promise.all([this.repo.seatsSold(tripId), this.repo.paceHistory(t.service_id, tripId, leadDays, t.journey_date)]);
      const f = forecastOccupancy({ currentSold: current, totalSeats: t.total_seats, history: history.map((h) => ({ soldAtSameLead: Number(h.at_lead), finalSold: Number(h.final_sold) })) });
      return { tripId, currentSold: current, totalSeats: t.total_seats, daysToDeparture: leadDays, ...f };
    });
  }

  /** Forecast for every trip departing in the next N days (≤ 15), bounded concurrency. */
  async upcomingForecast(days: number) {
    const trips = await this.repo.upcomingTrips(Math.min(15, Math.max(1, days)));
    const items = await mapWithConcurrency(trips, 4, async (t: { id: string; journey_date: string; route_name: string }) => ({ routeName: t.route_name, journeyDate: t.journey_date, ...(await this.forecast(t.id as TripId)) }));
    return { items };
  }
}
