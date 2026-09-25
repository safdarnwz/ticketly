import { Injectable } from '@nestjs/common';

import { currentTransaction, registerConstraintMessages, UnitOfWork } from '@database';
import { newId, requireTenantId, type BookingId, type TripId, type UserId } from '@kernel';

import type { QuotaHolderType } from '../domain/quota-rules';

registerConstraintMessages({
  seat_quotas_live_uq: 'One of these seats is already allocated to someone',
});

/** All bits set: blocks the seat on every segment regardless of stop numbering. */
const FULL_MASK = '-1';

export interface SeatQuota {
  id: string;
  tripId: string;
  seatNumber: string;
  holderType: QuotaHolderType;
  holderId: string;
  holderName: string | null;
  releaseAt: Date;
  releasedAt: Date | null;
  releaseReason: string | null;
  consumedAt: Date | null;
  consumedBookingId: string | null;
}

/** Every write runs on the caller's transaction (currentTransaction) so checks + block + insert are atomic. */
@Injectable()
export class SeatQuotaRepository {
  constructor(private readonly uow: UnitOfWork) {}

  private tx() {
    const t = currentTransaction();
    if (!t) throw new Error('SeatQuotaRepository requires a transaction');
    return t;
  }

  async holderStatus(type: QuotaHolderType, id: string): Promise<string | null> {
    const table = type === 'agent' ? 'agents' : 'branches';
    const r = await this.tx().client.query<{ status: string }>(
      `SELECT status::text AS status FROM ${table} WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
    );
    return r.rows[0]?.status ?? null;
  }

  /** Lock the seats; report the ones that are missing, occupied, blocked or mid-checkout. */
  /** Every bookable seat of the trip, in seat-number order. */
  async bookableSeats(tripId: TripId): Promise<string[]> {
    const t = this.tx();
    const rows = (
      await t.client.query<{ seat_number: string }>(
        `SELECT seat_number FROM trip_seats WHERE tenant_id = $1 AND trip_id = $2 AND is_bookable
          ORDER BY length(seat_number), seat_number`,
        [requireTenantId(), tripId],
      )
    ).rows;
    return rows.map((r) => r.seat_number);
  }

  async lockAndInspect(
    tripId: TripId,
    seats: string[],
  ): Promise<{ missing: string[]; busy: string[] }> {
    const t = this.tx();
    const rows = (
      await t.client.query<{ seat_number: string; occupied_legs: string; blocked_legs: string }>(
        `SELECT seat_number, occupied_legs, blocked_legs FROM trip_seats
        WHERE tenant_id = $1 AND trip_id = $2 AND seat_number = ANY($3::text[]) FOR UPDATE`,
        [requireTenantId(), tripId, seats],
      )
    ).rows;
    const found = new Set(rows.map((r) => r.seat_number));
    const busy = rows
      .filter((r) => r.occupied_legs !== '0' || r.blocked_legs !== '0')
      .map((r) => r.seat_number);
    // A customer may be mid-checkout on the seat: occupancy is only committed
    // at confirm, so an unexpired HELD booking must also count as busy.
    const held = (
      await t.client.query<{ seat_number: string }>(
        `SELECT DISTINCT bs.seat_number FROM booking_seats bs JOIN bookings b ON b.id = bs.booking_id
        WHERE b.tenant_id = $1 AND bs.trip_id = $2 AND bs.seat_number = ANY($3::text[])
          AND b.status = 'held' AND b.hold_expires_at > now()`,
        [requireTenantId(), tripId, seats],
      )
    ).rows.map((r) => r.seat_number);
    return { missing: seats.filter((s) => !found.has(s)), busy: [...new Set([...busy, ...held])] };
  }

  async allocate(input: {
    tripId: TripId;
    seats: string[];
    holderType: QuotaHolderType;
    holderId: string;
    releaseAt: Date;
    createdBy: UserId | null;
  }): Promise<number> {
    const t = this.tx();
    const tenantId = requireTenantId();
    await t.client.query(
      `UPDATE trip_seats SET blocked_legs = blocked_legs | ${FULL_MASK}::bigint, version = version + 1
        WHERE tenant_id = $1 AND trip_id = $2 AND seat_number = ANY($3::text[])`,
      [tenantId, input.tripId, input.seats],
    );
    const res = await t.client.query(
      `INSERT INTO seat_quotas (id, tenant_id, trip_id, seat_number, holder_type, holder_id, mask, release_at, created_by)
       SELECT s.id, $1, $2, s.seat_number, $4, $5, ${FULL_MASK}::bigint, $6, $7
         FROM unnest($3::text[], $8::uuid[]) AS s(seat_number, id)`,
      [
        tenantId,
        input.tripId,
        input.seats,
        input.holderType,
        input.holderId,
        input.releaseAt,
        input.createdBy,
        input.seats.map(() => newId()),
      ],
    );
    return res.rowCount ?? 0;
  }

  async list(tripId: TripId, liveOnly: boolean): Promise<SeatQuota[]> {
    const r = await this.uow.run(
      { name: 'quota.list', tenantId: requireTenantId(), readOnly: true },
      async (scope) =>
        scope.client.query<SeatQuota>(
          `SELECT q.id, q.trip_id AS "tripId", q.seat_number AS "seatNumber", q.holder_type AS "holderType", q.holder_id AS "holderId",
              coalesce(a.name, br.name) AS "holderName", q.release_at AS "releaseAt", q.released_at AS "releasedAt",
              q.release_reason AS "releaseReason", q.consumed_at AS "consumedAt", q.consumed_booking_id AS "consumedBookingId"
         FROM seat_quotas q
         LEFT JOIN agents a ON q.holder_type = 'agent' AND a.id = q.holder_id
         LEFT JOIN branches br ON q.holder_type = 'branch' AND br.id = q.holder_id
        WHERE q.tenant_id = $1 AND q.trip_id = $2
          AND (NOT $3::boolean OR (q.released_at IS NULL AND q.consumed_at IS NULL))
        ORDER BY q.seat_number`,
          [requireTenantId(), tripId, liveOnly],
        ),
    );
    return r.rows;
  }

  /** Live quota seats of THIS holder among the requested seats (locked). */
  async lockHolderSeats(
    tripId: TripId,
    seats: string[],
    holderType: QuotaHolderType,
    holderId: string,
  ): Promise<{ id: string; seatNumber: string; releaseAt: Date }[]> {
    return (
      await this.tx().client.query<{ id: string; seat_number: string; release_at: Date }>(
        `SELECT id, seat_number, release_at FROM seat_quotas
        WHERE tenant_id = $1 AND trip_id = $2 AND seat_number = ANY($3::text[])
          AND holder_type = $4 AND holder_id = $5 AND released_at IS NULL AND consumed_at IS NULL
        FOR UPDATE`,
        [requireTenantId(), tripId, seats, holderType, holderId],
      )
    ).rows.map((r) => ({ id: r.id, seatNumber: r.seat_number, releaseAt: r.release_at }));
  }

  /** Clear the quota bits and close the rows — as released (reason) or consumed (by a booking of the holder). */
  async close(
    ids: string[],
    outcome:
      { kind: 'released'; reason: string } | { kind: 'consumed'; bookingId?: BookingId | null },
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const t = this.tx();
    const res = await t.client.query<{ n: string }>(
      `WITH closed AS (
         UPDATE seat_quotas SET
           released_at = CASE WHEN $3 = 'released' THEN now() END,
           release_reason = CASE WHEN $3 = 'released' THEN $4 END,
           consumed_at = CASE WHEN $3 = 'consumed' THEN now() END,
           consumed_booking_id = $5
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND released_at IS NULL AND consumed_at IS NULL
         RETURNING trip_id, seat_number, mask)
       UPDATE trip_seats ts SET blocked_legs = ts.blocked_legs & ~c.mask, version = ts.version + 1
         FROM closed c WHERE ts.trip_id = c.trip_id AND ts.seat_number = c.seat_number
       RETURNING 1 AS n`,
      [
        requireTenantId(),
        ids,
        outcome.kind,
        outcome.kind === 'released' ? outcome.reason : null,
        outcome.kind === 'consumed' ? (outcome.bookingId ?? null) : null,
      ],
    );
    return res.rowCount ?? 0;
  }

  async liveIdsForSeats(tripId: TripId, seats: string[]): Promise<string[]> {
    return (
      await this.tx().client.query<{ id: string }>(
        `SELECT id FROM seat_quotas WHERE tenant_id = $1 AND trip_id = $2 AND seat_number = ANY($3::text[])
          AND released_at IS NULL AND consumed_at IS NULL FOR UPDATE`,
        [requireTenantId(), tripId, seats],
      )
    ).rows.map((r) => r.id);
  }

  /** Worker: return every due, unsold quota seat to general sale — all tenants, one statement. */
  async releaseDue(): Promise<number> {
    return this.uow.run({ name: 'quota.releaseDue', bypassRls: true }, async (scope) => {
      const res = await scope.client.query(
        `WITH due AS (
           UPDATE seat_quotas SET released_at = now(), release_reason = 'Auto-released before departure'
            WHERE released_at IS NULL AND consumed_at IS NULL AND release_at <= now()
           RETURNING trip_id, seat_number, mask)
         UPDATE trip_seats ts SET blocked_legs = ts.blocked_legs & ~d.mask, version = ts.version + 1
           FROM due d WHERE ts.trip_id = d.trip_id AND ts.seat_number = d.seat_number
         RETURNING 1`,
      );
      return res.rowCount ?? 0;
    });
  }
}
