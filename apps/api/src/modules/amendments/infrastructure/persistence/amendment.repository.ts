import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { type BookingId, type TenantId, type TripId, type UserId } from '@kernel';

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
}
