import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId, type LocalDate } from '@kernel';

/**
 * Reporting — reads the pre-aggregated materialized views (refreshed by the
 * worker), so a dashboard query is a small indexed lookup rather than a live
 * scan of bookings/ledger. Every query filters by the ambient tenant_id; the
 * base tables under the views remain RLS-protected.
 *
 * Reads route to a replica (analytics never informs a write decision).
 */
@Injectable()
export class ReportingService {
  constructor(private readonly db: DatabaseService) {}

  /** Operator revenue over a date range, from mv_operator_revenue_daily. */
  async revenue(from: LocalDate, to: LocalDate): Promise<unknown> {
    const rows = await this.db.query(
      `SELECT revenue_date AS "date", bookings, gross_minor AS "grossMinor",
              cancelled_minor AS "cancelledMinor", seats_sold AS "seatsSold"
         FROM mv_operator_revenue_daily
        WHERE tenant_id = $1 AND revenue_date BETWEEN $2 AND $3
        ORDER BY revenue_date`,
      [requireTenantId(), from, to],
      { name: 'report.revenue' },
    );
    const totals = rows.reduce(
      (acc: { grossMinor: number; bookings: number; seatsSold: number }, r) => {
        const row = r as { grossMinor: number; bookings: number; seatsSold: number };
        acc.grossMinor += Number(row.grossMinor);
        acc.bookings += Number(row.bookings);
        acc.seatsSold += Number(row.seatsSold);
        return acc;
      },
      { grossMinor: 0, bookings: 0, seatsSold: 0 },
    );
    return { series: rows, totals };
  }

  /** Route occupancy leaderboard (last 30 days), from mv_route_performance. */
  async routePerformance(): Promise<unknown> {
    return this.db.query(
      `SELECT mv.route_id AS "routeId", r.name AS "routeName", r.code AS "routeCode", mv.trips, mv.total_capacity AS "totalCapacity",
              mv.seats_sold AS "seatsSold", mv.occupancy_pct AS "occupancyPct", mv.revenue_minor AS "revenueMinor"
         FROM mv_route_performance mv
         JOIN routes r ON r.id = mv.route_id AND r.tenant_id = mv.tenant_id
        WHERE mv.tenant_id = $1
        ORDER BY mv.revenue_minor DESC LIMIT 100`,
      [requireTenantId()],
      { name: 'report.routePerformance' },
    );
  }

  /** Daily occupancy for a route, from mv_trip_daily. */
  async occupancy(from: LocalDate, to: LocalDate): Promise<unknown> {
    return this.db.query(
      `SELECT journey_date AS "date", route_id AS "routeId", trips, total_seats AS "totalSeats",
              sold_seats AS "soldSeats",
              CASE WHEN total_seats > 0 THEN round(100.0 * sold_seats / total_seats, 1) ELSE 0 END AS "occupancyPct",
              revenue_minor AS "revenueMinor"
         FROM mv_trip_daily
        WHERE tenant_id = $1 AND journey_date BETWEEN $2 AND $3
        ORDER BY journey_date`,
      [requireTenantId(), from, to],
      { name: 'report.occupancy' },
    );
  }

  /** CSV export of the revenue series (streamed as text for download). */
  async revenueCsv(from: LocalDate, to: LocalDate): Promise<string> {
    const { series } = (await this.revenue(from, to)) as { series: Record<string, unknown>[] };
    const header = 'date,bookings,gross,cancelled,seats_sold';
    const lines = series.map((r) =>
      [r.date, r.bookings, Number(r.grossMinor) / 100, Number(r.cancelledMinor) / 100, r.seatsSold].join(','),
    );
    return [header, ...lines].join('\n');
  }

  /** Cancellations over a date range — count, refund total, and a same-period cancellation rate vs all bookings. */
  async cancellationReport(from: LocalDate, to: LocalDate): Promise<unknown> {
    const rows = await this.db.query(
      `SELECT created_at::date AS "date", count(*) AS "cancelledCount",
              coalesce(sum(total_minor - paid_minor), 0) AS "refundedMinor"
         FROM bookings
        WHERE tenant_id = $1 AND status = 'cancelled' AND created_at::date BETWEEN $2 AND $3
        GROUP BY created_at::date ORDER BY created_at::date`,
      [requireTenantId(), from, to],
      { name: 'report.cancellations' },
    );
    const totals = await this.db.queryOne<{ total: string; cancelled: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE status = 'cancelled') AS cancelled
         FROM bookings WHERE tenant_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [requireTenantId(), from, to],
      { name: 'report.cancellationRate' },
    );
    const total = Number(totals?.total ?? 0);
    const cancelled = Number(totals?.cancelled ?? 0);
    return { series: rows, cancellationRatePct: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0, totalCancelled: cancelled, totalBookings: total };
  }

  /** Which hour of the day sells the most — helps staffing/counter-hours decisions. */
  async peakHourReport(from: LocalDate, to: LocalDate): Promise<unknown> {
    return this.db.query(
      `SELECT extract(hour FROM created_at)::int AS "hour", count(*) AS "bookingCount", coalesce(sum(total_minor), 0) AS "grossMinor"
         FROM bookings
        WHERE tenant_id = $1 AND status = 'confirmed' AND created_at::date BETWEEN $2 AND $3
        GROUP BY extract(hour FROM created_at) ORDER BY hour`,
      [requireTenantId(), from, to],
      { name: 'report.peakHour' },
    );
  }
}
