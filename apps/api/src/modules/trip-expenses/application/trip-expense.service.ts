import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, getUserId, newId, requireTenantId, type TripId } from '@kernel';

import { FileService } from '../../files';
import {
  ExpenseRuleError,
  computePnl,
  sumPnl,
  validateExpense,
  type ExpenseCategory,
  type Pnl,
  type PnlInput,
} from '../domain/pnl';
import {
  TripExpenseRepository,
  type PnlRow,
  type TripExpenseRow,
} from '../infrastructure/persistence/trip-expense.repository';

export type { TripExpenseRow };

const MAX_REPORT_DAYS = 92;

@Injectable()
export class TripExpenseService {
  constructor(
    private readonly expenses: TripExpenseRepository,
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
    const trip = await this.expenses.tripForExpense(tenantId, tripId);
    if (!trip) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
    try {
      validateExpense({ ...input, tripStatus: trip.status, tripDepartsAt: trip.departsAt });
    } catch (e) {
      if (e instanceof ExpenseRuleError)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
      throw e;
    }
    if (input.receiptFileId)
      await this.files.requireForPurpose(input.receiptFileId, 'expense_receipt');
    const id = newId();
    await this.expenses.insert({
      id,
      tenantId,
      tripId,
      category: input.category,
      amountMinor: input.amountMinor,
      note: input.note?.trim() || null,
      receiptFileId: input.receiptFileId ?? null,
      createdBy: getUserId() ?? null,
    });
    return { id };
  }

  async uploadReceipt(tripId: TripId, bytes: Buffer, fileName?: string) {
    // Only for this operator's trips (the id also names the storage folder).
    if (!(await this.expenses.tripForExpense(requireTenantId(), tripId)))
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
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
    const voided = await this.expenses.void(
      requireTenantId(),
      tripId,
      expenseId,
      reason.trim(),
      getUserId() ?? null,
    );
    if (!voided)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Expense not found or already voided',
      });
    return { ok: true };
  }

  list(tripId: TripId, includeVoided = false): Promise<TripExpenseRow[]> {
    return this.expenses.list(requireTenantId(), tripId, includeVoided);
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

  private pnlRows(f: {
    tripId?: string;
    from?: string;
    to?: string;
    routeId?: string;
    vehicleId?: string;
  }): Promise<PnlRow[]> {
    return this.expenses.pnlRows(requireTenantId(), f);
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
