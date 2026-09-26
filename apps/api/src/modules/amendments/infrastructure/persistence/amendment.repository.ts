import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type BookingId, type TenantId, type TripId, type UserId } from '@kernel';

export type AmendmentKind = 'reschedule' | 'seat_change' | 'point_change' | 'name_correction';

/** booking_amendments: the audit record of every change made to a booking after sale. */
@Injectable()
export class AmendmentRepository {
  constructor(private readonly db: DatabaseService) {}

  async record(a: {
    id: string;
    tenantId: TenantId;
    bookingId: BookingId;
    kind: AmendmentKind;
    detail: Record<string, unknown>;
    performedBy: UserId | null;
    newTripId?: TripId;
    money?: {
      feeMinor: number;
      fareDiffMinor: number;
      amountDueMinor: number;
      refundMinor: number;
    };
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO booking_amendments
         (id, tenant_id, booking_id, kind, new_trip_id, detail, fee_minor, fare_diff_minor,
          amount_due_minor, refund_minor, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        a.id,
        a.tenantId,
        a.bookingId,
        a.kind,
        a.newTripId ?? null,
        JSON.stringify(a.detail),
        a.money?.feeMinor ?? 0,
        a.money?.fareDiffMinor ?? 0,
        a.money?.amountDueMinor ?? 0,
        a.money?.refundMinor ?? 0,
        a.performedBy,
      ],
      { name: 'amendment.record', primary: true },
    );
  }

  /** Name corrections already made to one seat of a booking. */
  async countNameCorrections(bookingId: BookingId, seatNumber: string): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM booking_amendments
        WHERE booking_id = $1 AND kind = 'name_correction' AND detail->>'seat' = $2`,
      [bookingId, seatNumber],
      { name: 'amendment.countNameCorrections', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  /**
   * Other buses of this operator on one day (its own time zone) that stop at
   * both of the booking's points in order — where a date change can go. Only
   * open trips whose boarding time is still ahead.
   */
  rescheduleTargets(q: {
    excludeTripId: string;
    fromStopId: string;
    toStopId: string;
    date: string;
  }): Promise<
    {
      tripId: string;
      routeName: string;
      departsAt: Date;
      boardsAt: Date;
      dropsAt: Date;
      fromSeq: number;
      toSeq: number;
    }[]
  > {
    return this.db.query(
      `SELECT t.id AS "tripId", r.name AS "routeName", t.departs_at AS "departsAt",
              f.departs_at AS "boardsAt", d.arrives_at AS "dropsAt",
              f.sequence AS "fromSeq", d.sequence AS "toSeq"
         FROM trips t
         JOIN routes r ON r.id = t.route_id
         JOIN tenants tn ON tn.id = t.tenant_id
         JOIN trip_stops f ON f.trip_id = t.id AND f.stop_id = $3 AND f.can_board
         JOIN trip_stops d ON d.trip_id = t.id AND d.stop_id = $4 AND d.can_alight
                          AND d.sequence > f.sequence
        WHERE t.tenant_id = $1 AND t.id <> $2 AND t.status = 'open'
          AND f.departs_at > now()
          AND (f.departs_at AT TIME ZONE tn.timezone)::date = $5::date
        ORDER BY f.departs_at
        LIMIT 30`,
      [requireTenantId(), q.excludeTripId, q.fromStopId, q.toStopId, q.date],
      { name: 'amend.rescheduleTargets' },
    );
  }
}
