import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { type TenantId, type TripId } from '@kernel';

/**
 * Per-trip P&L inputs for every trip in a set — ONE set-based query (CTEs),
 * never one query per trip, so a 3-month route report is a single round trip.
 *   sales  = active bookings' totals + fares RETAINED on cancellations (paid − refunded)
 *   gst    = active bookings' GST
 *   commission / commission GST = net platform ledger postings for the trip's bookings
 *   seats  = booked seats of active bookings (real rows, not a stored counter)
 */
const PNL_SQL = `
WITH t AS (
  SELECT id, route_id, vehicle_id, journey_date, departs_at, total_seats, status::text AS status FROM trips
   WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id = $2) AND ($3::date IS NULL OR journey_date BETWEEN $3 AND $4)
     AND ($5::uuid IS NULL OR route_id = $5) AND ($6::uuid IS NULL OR vehicle_id = $6)
), b AS (
  SELECT bk.trip_id, sum(bk.total_minor) AS sales, sum(bk.tax_minor) AS gst
    FROM bookings bk JOIN t ON t.id = bk.trip_id
   WHERE bk.tenant_id = $1 AND bk.status IN ('confirmed', 'completed') GROUP BY bk.trip_id
), s AS (
  SELECT bs.trip_id, count(*) AS seats FROM booking_seats bs JOIN bookings bk ON bk.id = bs.booking_id JOIN t ON t.id = bs.trip_id
   WHERE bk.tenant_id = $1 AND bk.status IN ('confirmed', 'completed') GROUP BY bs.trip_id
), c AS (
  SELECT bk.trip_id, sum(cn.paid_minor - cn.refund_minor) AS retained
    FROM cancellations cn JOIN bookings bk ON bk.id = cn.booking_id JOIN t ON t.id = bk.trip_id
   WHERE bk.tenant_id = $1 GROUP BY bk.trip_id
), l AS (
  SELECT bk.trip_id,
         sum(CASE WHEN lp.account = 'platform_revenue' THEN -lp.amount_minor ELSE 0 END) AS commission,
         sum(CASE WHEN lp.account = 'commission_tax_payable' THEN -lp.amount_minor ELSE 0 END) AS commission_gst
    FROM ledger_postings lp JOIN ledger_entries le ON le.id = lp.entry_id
    JOIN bookings bk ON le.source_type = 'booking' AND le.source_id = bk.id::text AND le.tenant_id = bk.tenant_id JOIN t ON t.id = bk.trip_id
   WHERE lp.tenant_id = $1 GROUP BY bk.trip_id
), e AS (
  SELECT x.trip_id, sum(x.amount_minor) AS expenses FROM trip_expenses x JOIN t ON t.id = x.trip_id
   WHERE x.tenant_id = $1 AND x.voided_at IS NULL GROUP BY x.trip_id
)
SELECT t.id AS trip_id, t.route_id, t.vehicle_id, t.journey_date::text AS journey_date, t.status, r.name AS route_name, v.registration_no,
       t.total_seats, coalesce(b.sales, 0) + coalesce(c.retained, 0) AS sales, coalesce(b.gst, 0) AS gst,
       coalesce(l.commission, 0) AS commission, coalesce(l.commission_gst, 0) AS commission_gst,
       coalesce(e.expenses, 0) AS expenses, coalesce(s.seats, 0) AS seats
  FROM t JOIN routes r ON r.id = t.route_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
  LEFT JOIN b ON b.trip_id = t.id LEFT JOIN s ON s.trip_id = t.id LEFT JOIN c ON c.trip_id = t.id
  LEFT JOIN l ON l.trip_id = t.id LEFT JOIN e ON e.trip_id = t.id
 ORDER BY t.departs_at`;

export interface PnlRow {
  trip_id: string;
  route_id: string;
  vehicle_id: string | null;
  journey_date: string;
  status: string;
  route_name: string;
  registration_no: string | null;
  total_seats: number;
  sales: string;
  gst: string;
  commission: string;
  commission_gst: string;
  expenses: string;
  seats: string;
}

export interface TripExpenseRow {
  id: string;
  category: string;
  /** bigint → string from pg. */
  amountMinor: string;
  note: string | null;
  receiptFileId: string | null;
  incurredAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  createdBy: string | null;
}

/** trip_expenses, and the per-trip P&L read over bookings, cancellations and the ledger. */
@Injectable()
export class TripExpenseRepository {
  constructor(private readonly uow: UnitOfWork) {}

  /** The trip's status and departure (what decides whether an expense is allowed). */
  tripForExpense(
    tenantId: TenantId,
    tripId: TripId,
  ): Promise<{ status: string; departsAt: Date } | null> {
    return this.uow.run({ name: 'expense.trip', tenantId, readOnly: true }, async (scope) => {
      const r = await scope.client.query<{ status: string; departsAt: Date }>(
        `SELECT status::text AS status, departs_at AS "departsAt" FROM trips WHERE tenant_id = $1 AND id = $2`,
        [tenantId, tripId],
      );
      return r.rows[0] ?? null;
    });
  }

  async insert(x: {
    id: string;
    tenantId: TenantId;
    tripId: TripId;
    category: string;
    amountMinor: number;
    note: string | null;
    receiptFileId: string | null;
    createdBy: string | null;
  }): Promise<void> {
    await this.uow.run({ name: 'expense.add', tenantId: x.tenantId }, async (scope) => {
      await scope.client.query(
        `INSERT INTO trip_expenses (id, tenant_id, trip_id, category, amount_minor, note, receipt_file_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          x.id,
          x.tenantId,
          x.tripId,
          x.category,
          x.amountMinor,
          x.note,
          x.receiptFileId,
          x.createdBy,
        ],
      );
    });
  }

  /** Void an expense (never deleted — audit trail); false if missing or already void. */
  void(
    tenantId: TenantId,
    tripId: TripId,
    expenseId: string,
    reason: string,
    voidedBy: string | null,
  ): Promise<boolean> {
    return this.uow.run({ name: 'expense.void', tenantId }, async (scope) => {
      const r = await scope.client.query(
        `UPDATE trip_expenses SET voided_at = now(), void_reason = $4, voided_by = $5
          WHERE tenant_id = $1 AND trip_id = $2 AND id = $3 AND voided_at IS NULL`,
        [tenantId, tripId, expenseId, reason, voidedBy],
      );
      return (r.rowCount ?? 0) > 0;
    });
  }

  list(tenantId: TenantId, tripId: TripId, includeVoided: boolean): Promise<TripExpenseRow[]> {
    return this.uow.run({ name: 'expense.list', tenantId, readOnly: true }, async (scope) => {
      const r = await scope.client.query<TripExpenseRow>(
        `SELECT x.id, x.category, x.amount_minor::bigint AS "amountMinor", x.note,
                x.receipt_file_id AS "receiptFileId", x.incurred_at AS "incurredAt",
                x.voided_at AS "voidedAt", x.void_reason AS "voidReason", u.full_name AS "createdBy"
           FROM trip_expenses x LEFT JOIN users u ON u.id = x.created_by
          WHERE x.tenant_id = $1 AND x.trip_id = $2 AND ($3::boolean OR x.voided_at IS NULL)
          ORDER BY x.incurred_at DESC`,
        [tenantId, tripId, includeVoided],
      );
      return r.rows;
    });
  }

  /** Per-trip P&L inputs for every trip matching the filter, in one query. */
  pnlRows(
    tenantId: TenantId,
    f: { tripId?: string; from?: string; to?: string; routeId?: string; vehicleId?: string },
  ): Promise<PnlRow[]> {
    return this.uow.run({ name: 'expense.pnl', tenantId, readOnly: true }, async (scope) => {
      const r = await scope.client.query<PnlRow>(PNL_SQL, [
        tenantId,
        f.tripId ?? null,
        f.from ?? null,
        f.to ?? null,
        f.routeId ?? null,
        f.vehicleId ?? null,
      ]);
      return r.rows;
    });
  }
}
