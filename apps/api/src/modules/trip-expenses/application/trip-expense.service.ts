import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, getUserId, newId, requireTenantId, type TripId } from '@kernel';

import { FileService } from '../../files/application/file.service';
import {
  ExpenseRuleError,
  computePnl,
  sumPnl,
  validateExpense,
  type ExpenseCategory,
  type Pnl,
  type PnlInput,
} from '../domain/pnl';

const MAX_REPORT_DAYS = 92;

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

interface PnlRow {
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

@Injectable()
export class TripExpenseService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly files: FileService,
  ) {}

  async add(
    tripId: TripId,
    input: {
      category: ExpenseCategory;
      amountMinor: number;
      note?: string;
      receiptFileId?: string;
    },
  ) {
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'expense.add', tenantId }, async (scope) => {
      const trip = (
        await scope.client.query<{ status: string; departs_at: Date }>(
          `SELECT status::text AS status, departs_at FROM trips WHERE tenant_id = $1 AND id = $2`,
          [tenantId, tripId],
        )
      ).rows[0];
      if (!trip) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
      try {
        validateExpense({ ...input, tripStatus: trip.status, tripDepartsAt: trip.departs_at });
      } catch (e) {
        if (e instanceof ExpenseRuleError)
          throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
        throw e;
      }
      if (input.receiptFileId)
        await this.files.requireForPurpose(input.receiptFileId, 'expense_receipt');
      const id = newId();
      await scope.client.query(
        `INSERT INTO trip_expenses (id, tenant_id, trip_id, category, amount_minor, note, receipt_file_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          tenantId,
          tripId,
          input.category,
          input.amountMinor,
          input.note?.trim() || null,
          input.receiptFileId ?? null,
          getUserId() ?? null,
        ],
      );
      return { id };
    });
  }

  async uploadReceipt(tripId: TripId, bytes: Buffer, fileName?: string) {
    const f = await this.files.upload({
      purpose: 'expense_receipt',
      bytes,
      fileName,
      sub: ['trips', String(tripId), 'receipts'],
    });
    return { fileId: f.id, fileName: f.fileName };
  }

  async void(tripId: TripId, expenseId: string, reason: string) {
    if ((reason?.trim().length ?? 0) < 5)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Give a reason (at least 5 characters) for voiding',
      });
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'expense.void', tenantId }, async (scope) => {
      const res = await scope.client.query(
        `UPDATE trip_expenses SET voided_at = now(), void_reason = $4, voided_by = $5
          WHERE tenant_id = $1 AND trip_id = $2 AND id = $3 AND voided_at IS NULL RETURNING id`,
        [tenantId, tripId, expenseId, reason.trim(), getUserId() ?? null],
      );
      if (res.rowCount === 0)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: 'Expense not found or already voided',
        });
      return { ok: true };
    });
  }

  async list(tripId: TripId, includeVoided = false): Promise<TripExpenseRow[]> {
    return this.uow.run(
      { name: 'expense.list', tenantId: requireTenantId(), readOnly: true },
      async (scope) =>
        (
          await scope.client.query<TripExpenseRow>(
            `SELECT x.id, x.category, x.amount_minor::bigint AS "amountMinor", x.note, x.receipt_file_id AS "receiptFileId", x.incurred_at AS "incurredAt",
              x.voided_at AS "voidedAt", x.void_reason AS "voidReason", u.full_name AS "createdBy"
         FROM trip_expenses x LEFT JOIN users u ON u.id = x.created_by
        WHERE x.tenant_id = $1 AND x.trip_id = $2 AND ($3::boolean OR x.voided_at IS NULL)
        ORDER BY x.incurred_at DESC`,
            [requireTenantId(), tripId, includeVoided],
          )
        ).rows,
    );
  }

  async tripPnl(
    tripId: TripId,
  ): Promise<
    Pnl & { tripId: string; routeName: string; registrationNo: string | null; journeyDate: string }
  > {
    const rows = await this.pnlRows({ tripId });
    if (!rows.length)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
    const r = rows[0];
    return {
      tripId: r.trip_id,
      routeName: r.route_name,
      registrationNo: r.registration_no,
      journeyDate: r.journey_date,
      ...computePnl(toInput(r)),
    };
  }

  /** P&L over a period, grouped by trip, route or bus, plus the overall total. */
  async report(input: {
    from: string;
    to: string;
    groupBy: 'trip' | 'route' | 'vehicle';
    routeId?: string;
    vehicleId?: string;
  }) {
    const days = (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000;
    if (Number.isNaN(days) || days < 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: '"from" must be a date on or before "to"',
      });
    if (days > MAX_REPORT_DAYS)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: `A report can cover at most ${MAX_REPORT_DAYS} days`,
      });
    const rows = await this.pnlRows({
      from: input.from,
      to: input.to,
      routeId: input.routeId,
      vehicleId: input.vehicleId,
    });
    const key = (r: PnlRow) =>
      input.groupBy === 'trip'
        ? r.trip_id
        : input.groupBy === 'route'
          ? r.route_id
          : (r.vehicle_id ?? 'unassigned');
    const label = (r: PnlRow) =>
      input.groupBy === 'trip'
        ? `${r.route_name} · ${r.journey_date}`
        : input.groupBy === 'route'
          ? r.route_name
          : (r.registration_no ?? 'No bus assigned');
    const groups = new Map<string, { label: string; trips: number; rows: PnlInput[] }>();
    for (const r of rows) {
      const g = groups.get(key(r)) ?? { label: label(r), trips: 0, rows: [] };
      g.trips += 1;
      g.rows.push(toInput(r));
      groups.set(key(r), g);
    }
    const items = [...groups.entries()]
      .map(([id, g]) => ({ id, label: g.label, trips: g.trips, ...sumPnl(g.rows) }))
      .sort((a, b) => a.profitMinor - b.profitMinor); // worst first: what needs attention
    return {
      period: { from: input.from, to: input.to },
      groupBy: input.groupBy,
      items,
      total: { trips: rows.length, ...sumPnl(rows.map(toInput)) },
    };
  }

  private async pnlRows(f: {
    tripId?: string;
    from?: string;
    to?: string;
    routeId?: string;
    vehicleId?: string;
  }): Promise<PnlRow[]> {
    return this.uow.run(
      { name: 'expense.pnl', tenantId: requireTenantId(), readOnly: true },
      async (scope) =>
        (
          await scope.client.query<PnlRow>(PNL_SQL, [
            requireTenantId(),
            f.tripId ?? null,
            f.from ?? null,
            f.to ?? null,
            f.routeId ?? null,
            f.vehicleId ?? null,
          ])
        ).rows,
    );
  }
}

function toInput(r: PnlRow): PnlInput {
  return {
    salesMinor: Number(r.sales),
    gstMinor: Number(r.gst),
    commissionMinor: Number(r.commission),
    commissionGstMinor: Number(r.commission_gst),
    expensesMinor: Number(r.expenses),
    seatsSold: Number(r.seats),
    seatsTotal: Number(r.total_seats),
  };
}
