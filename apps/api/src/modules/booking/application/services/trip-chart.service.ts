import { Injectable } from '@nestjs/common';

import { type TripId } from '@kernel';

import { InventoryRepository, SchedulingService, TripRepository } from '../../../scheduling';
import {
  BookingRepository,
  type TripOccupant,
} from '../../infrastructure/persistence/booking.repository';

export interface ChartSeat {
  seatNumber: string;
  seatType: string;
  deck: number;
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  ladiesOnly: boolean;
  /** Kept off sale by the operator on some or all of the route. */
  blocked: boolean;
  /** Never for sale (e.g. crew seat). */
  bookable: boolean;
  /** Everyone travelling in this seat, in route order (one seat can carry several short journeys). */
  occupants: (TripOccupant & { from: string | null; to: string | null })[];
}

/**
 * The reservation chart of one trip for the operator's staff — the bus
 * layout with who sits where (and from which stop to which), what is on hold
 * right now, what is blocked, and the trip's totals.
 */
@Injectable()
export class TripChartService {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly trips: TripRepository,
    private readonly inventory: InventoryRepository,
    private readonly bookings: BookingRepository,
  ) {}

  async chart(tripId: TripId) {
    const detail = await this.scheduling.tripDetail(tripId);
    const stops = detail.stops;
    const first = stops[0];
    const last = stops[stops.length - 1];
    const [map, occupants, heldBack, ran] = await Promise.all([
      first && last
        ? this.scheduling.seatMap(tripId, first.stopId, last.stopId)
        : Promise.resolve(null),
      this.bookings.tripOccupants(tripId),
      this.inventory.heldBack(tripId),
      this.trips.hasRun(tripId),
    ]);
    const nameAt = new Map(stops.map((s) => [s.sequence, s.name]));
    const bySeat = new Map<string, ChartSeat['occupants']>();
    for (const o of occupants) {
      const list = bySeat.get(o.seatNumber) ?? [];
      list.push({ ...o, from: nameAt.get(o.fromSeq) ?? null, to: nameAt.get(o.toSeq) ?? null });
      bySeat.set(o.seatNumber, list);
    }
    const back = new Map(heldBack.map((h) => [h.seatNumber, h]));
    const seats: ChartSeat[] = (map?.seats ?? []).map((s) => ({
      seatNumber: s.seatNumber,
      seatType: s.seatType,
      deck: s.deck,
      row: s.row,
      column: s.column,
      rowSpan: s.rowSpan,
      colSpan: s.colSpan,
      ladiesOnly: s.ladiesOnly,
      blocked: back.get(s.seatNumber)?.blocked ?? false,
      bookable: back.get(s.seatNumber)?.bookable ?? true,
      occupants: bySeat.get(s.seatNumber) ?? [],
    }));

    const paid = occupants.filter((o) => !o.onHold);
    const bookingIds = new Set(paid.map((o) => o.bookingId));
    return {
      trip: { ...detail.trip, hasRun: ran },
      stops,
      layout: map?.layout ?? { decks: 1, rows: 0, columns: 0 },
      seats,
      totals: {
        seats: seats.length,
        seatsWithPassengers: seats.filter((s) => s.occupants.some((o) => !o.onHold)).length,
        passengers: paid.length,
        bookings: bookingIds.size,
        onHold: occupants.length - paid.length,
        blocked: seats.filter((s) => s.blocked).length,
        boarded: paid.filter((o) => o.ticketStatus === 'boarded').length,
        free: seats.filter((s) => s.bookable && !s.blocked && s.occupants.length === 0).length,
      },
    };
  }
}
