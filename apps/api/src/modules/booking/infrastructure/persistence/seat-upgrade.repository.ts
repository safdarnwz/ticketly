import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { AppError, ErrorCode, newId, requireTenantId, type TripId } from '@kernel';

import { SegmentMap } from '../../../scheduling/domain/segment-inventory';
import { SeatLockRepository } from './seat-lock.repository';

@Injectable()
export class SeatUpgradeRepository {
  constructor(
    private readonly seatLock: SeatLockRepository,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Swap a ticket's seat within the SAME booking/segment — release the old
   * seat's occupancy bits, lock+commit the new one. Must run inside the
   * SAME transaction as the ticket-row update and the seat_upgrades audit
   * insert, so a failure partway through never leaves the trip's inventory
   * bitmap out of sync with what a ticket actually says.
   */
  async swapSeat(tripId: TripId, stopCount: number, fromSeq: number, toSeq: number, fromSeatNumber: string, toSeatNumber: string): Promise<void> {
    const tx = currentTransaction();
    if (!tx) throw new Error('swapSeat must run inside a transaction');

    const map = SegmentMap.forStops(stopCount);
    const legMask = map.segmentMask(fromSeq, toSeq);

    // Row-lock BOTH seats (deterministic order — same anti-deadlock pattern as lockSeats) and verify the target is actually free before touching anything.
    const ordered = [fromSeatNumber, toSeatNumber].sort();
    const rows = await tx.client.query<{ seat_number: string; occupied_legs: string; blocked_legs: string; is_bookable: boolean }>(
      `SELECT seat_number, occupied_legs, blocked_legs, is_bookable FROM trip_seats
        WHERE trip_id = $1 AND seat_number = ANY($2::text[]) FOR UPDATE`,
      [tripId, ordered],
    );
    const target = rows.rows.find((r) => r.seat_number === toSeatNumber);
    if (!target) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: `Seat ${toSeatNumber} not found on this trip` });
    if (!target.is_bookable) throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, { message: `Seat ${toSeatNumber} is not bookable` });
    const targetOccupied = BigInt(target.occupied_legs) | BigInt(target.blocked_legs);
    if ((targetOccupied & legMask) !== 0n) {
      throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 409, { message: `Seat ${toSeatNumber} is already taken on this segment` });
    }

    await this.seatLock.releaseOccupancy(tripId, [{ seatNumber: fromSeatNumber, legMask }]);
    await this.seatLock.commitOccupancy(tripId, [{ seatNumber: toSeatNumber, legMask }]);
  }

  async recordUpgrade(input: {
    bookingId: string; ticketId: string; fromSeatNumber: string; toSeatNumber: string;
    fromSeatType: string; toSeatType: string; differentialFareMinor: number; differentialTaxMinor: number;
  }): Promise<string> {
    const tx = currentTransaction();
    if (!tx) throw new Error('recordUpgrade must run inside a transaction');
    const id = newId();
    await tx.client.query(
      `INSERT INTO seat_upgrades (id, tenant_id, booking_id, ticket_id, from_seat_number, to_seat_number, from_seat_type, to_seat_type, differential_fare_minor, differential_tax_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, requireTenantId(), input.bookingId, input.ticketId, input.fromSeatNumber, input.toSeatNumber,
       input.fromSeatType, input.toSeatType, input.differentialFareMinor, input.differentialTaxMinor],
    );
    return id;
  }

  async updateTicketSeat(ticketId: string, newSeatNumber: string): Promise<void> {
    const tx = currentTransaction();
    if (!tx) throw new Error('updateTicketSeat must run inside a transaction');
    await tx.client.query(`UPDATE tickets SET seat_number = $2 WHERE id = $1`, [ticketId, newSeatNumber]);
  }

  /** Ticket + its current seat type (joined off trip_seats) — everything the upgrade flow needs to know about where a passenger currently sits. */
  async getTicketWithSeatType(ticketId: string): Promise<{ id: string; bookingId: string; tripId: string; seatNumber: string; seatType: string } | null> {
    const row = await this.db.queryOne<{ id: string; booking_id: string; trip_id: string; seat_number: string; seat_type: string }>(
      `SELECT t.id, t.booking_id, t.trip_id, t.seat_number, ts.seat_type
         FROM tickets t JOIN trip_seats ts ON ts.trip_id = t.trip_id AND ts.seat_number = t.seat_number
        WHERE t.tenant_id = $1 AND t.id = $2`,
      [requireTenantId(), ticketId],
      { name: 'seatUpgrade.getTicket' },
    );
    return row ? { id: row.id, bookingId: row.booking_id, tripId: row.trip_id, seatNumber: row.seat_number, seatType: row.seat_type } : null;
  }

  /** The NEW seat's type — looked up before the swap so the fare/differential can be computed against it. */
  async seatType(tripId: TripId, seatNumber: string): Promise<string | null> {
    const row = await this.db.queryOne<{ seat_type: string }>(
      `SELECT seat_type FROM trip_seats WHERE trip_id = $1 AND seat_number = $2`,
      [tripId, seatNumber],
      { name: 'seatUpgrade.seatType' },
    );
    return row?.seat_type ?? null;
  }

  async history(bookingId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT id, from_seat_number AS "fromSeatNumber", to_seat_number AS "toSeatNumber", differential_fare_minor AS "differentialFareMinor", created_at AS "createdAt"
         FROM seat_upgrades WHERE tenant_id = $1 AND booking_id = $2 ORDER BY created_at DESC`,
      [requireTenantId(), bookingId],
      { name: 'seatUpgrade.history' },
    );
  }
}
