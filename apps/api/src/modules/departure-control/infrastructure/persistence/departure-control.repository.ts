import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService, isUniqueViolation } from '@database';
import { AppError, ErrorCode, newId, requireTenantId, type TripId, type UserId } from '@kernel';

export interface TripCounts {
  totalSeats: number;
  confirmedSeats: number;
  boardedSeats: number;
}

/**
 * Departure-control persistence. The seat counts are read live from tickets +
 * the trip (the source of truth), so a chart always reflects the real position
 * at charting time; the chart row is the immutable closeout record.
 */
@Injectable()
export class DepartureControlRepository {
  constructor(private readonly db: DatabaseService) {}

  async tripCounts(tripId: TripId): Promise<TripCounts | null> {
    const row = await this.db.queryOne<{ total: number; confirmed: number; boarded: number }>(
      `SELECT t.total_seats AS total,
              coalesce(count(tk.id) FILTER (WHERE tk.status IN ('valid','boarded')), 0)::int AS confirmed,
              coalesce(count(tk.id) FILTER (WHERE tk.status = 'boarded'), 0)::int AS boarded
         FROM trips t
         LEFT JOIN tickets tk ON tk.trip_id = t.id AND tk.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1 AND t.id = $2
        GROUP BY t.total_seats`,
      [requireTenantId(), tripId],
      { name: 'dcs.tripCounts', primary: true },
    );
    if (!row) return null;
    return {
      totalSeats: Number(row.total),
      confirmedSeats: Number(row.confirmed),
      boardedSeats: Number(row.boarded),
    };
  }

  async findChart(tripId: TripId): Promise<unknown> {
    return this.db.queryOne(
      `SELECT id, trip_id AS "tripId", total_seats AS "totalSeats", confirmed_seats AS "confirmedSeats",
              boarded_seats AS "boardedSeats", no_show_seats AS "noShowSeats", vacant_seats AS "vacantSeats",
              spot_sales_count AS "spotSalesCount", cash_declared_minor AS "cashDeclaredMinor",
              cash_expected_minor AS "cashExpectedMinor", cash_variance_minor AS "cashVarianceMinor",
              reconciled, charted_at AS "chartedAt"
         FROM trip_charts WHERE tenant_id = $1 AND trip_id = $2`,
      [requireTenantId(), tripId],
      { name: 'dcs.findChart', primary: true },
    );
  }

  async insertChart(input: {
    tripId: TripId;
    totalSeats: number;
    confirmedSeats: number;
    boardedSeats: number;
    noShowSeats: number;
    vacantSeats: number;
    spotSalesCount: number;
    cashDeclaredMinor: number;
    cashExpectedMinor: number;
    cashVarianceMinor: number;
    reconciled: boolean;
    chartedBy: UserId | null;
  }): Promise<string> {
    const scope = currentTransaction();
    const id = newId();
    const sql = `INSERT INTO trip_charts
        (id, tenant_id, trip_id, total_seats, confirmed_seats, boarded_seats, no_show_seats, vacant_seats,
         spot_sales_count, cash_declared_minor, cash_expected_minor, cash_variance_minor, reconciled, charted_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`;
    const params = [
      id,
      requireTenantId(),
      input.tripId,
      input.totalSeats,
      input.confirmedSeats,
      input.boardedSeats,
      input.noShowSeats,
      input.vacantSeats,
      input.spotSalesCount,
      input.cashDeclaredMinor,
      input.cashExpectedMinor,
      input.cashVarianceMinor,
      input.reconciled,
      input.chartedBy,
    ];
    try {
      if (scope) await scope.client.query(sql, params);
      else await this.db.execute_(sql, params, { name: 'dcs.insertChart', primary: true });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(ErrorCode.DCS_ALREADY_CHARTED, 409, {
          message: 'This trip has already been charted',
        });
      }
      throw error;
    }
    return id;
  }
}
