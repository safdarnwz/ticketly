import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { DatabaseService } from '@database';
import { type LocalDate } from '@kernel';

/**
 * Report reads. Dashboards read the materialized views (refreshed by the
 * worker); the cancellation and peak-hour reports read the base tables.
 * Database sessions run in UTC, so every "which day / which hour" is taken in
 * the operator's timezone (`domain.timezone`) — a 1 a.m. IST booking belongs to
 * that IST day, not the previous UTC one.
 */
@Injectable()
export class ReportRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfig,
  ) {}

  private get tz(): string {
    return this.config.domain.timezone;
  }

  revenueDaily(
    tenantId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<
    {
      date: string;
      bookings: number;
      grossMinor: number;
      cancelledMinor: number;
      seatsSold: number;
    }[]
  > {
    return this.db.query(
      `SELECT revenue_date AS "date", bookings, gross_minor AS "grossMinor",
              cancelled_minor AS "cancelledMinor", seats_sold AS "seatsSold"
         FROM mv_operator_revenue_daily
        WHERE tenant_id = $1 AND revenue_date BETWEEN $2 AND $3
        ORDER BY revenue_date`,
      [tenantId, from, to],
      { name: 'report.revenue' },
    );
  }

  /** Route leaderboard over the last 30 days, best revenue first. */
  routePerformance(tenantId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT mv.route_id AS "routeId", r.name AS "routeName", r.code AS "routeCode", mv.trips,
              mv.total_capacity AS "totalCapacity", mv.seats_sold AS "seatsSold",
              mv.occupancy_pct AS "occupancyPct", mv.revenue_minor AS "revenueMinor"
         FROM mv_route_performance mv
         JOIN routes r ON r.id = mv.route_id AND r.tenant_id = mv.tenant_id
        WHERE mv.tenant_id = $1
        ORDER BY mv.revenue_minor DESC LIMIT 100`,
      [tenantId],
      { name: 'report.routePerformance' },
    );
  }

  occupancyDaily(tenantId: string, from: LocalDate, to: LocalDate): Promise<unknown[]> {
    return this.db.query(
      `SELECT journey_date AS "date", route_id AS "routeId", trips, total_seats AS "totalSeats",
              sold_seats AS "soldSeats",
              CASE WHEN total_seats > 0 THEN round(100.0 * sold_seats / total_seats, 1) ELSE 0 END AS "occupancyPct",
              revenue_minor AS "revenueMinor"
         FROM mv_trip_daily
        WHERE tenant_id = $1 AND journey_date BETWEEN $2 AND $3
        ORDER BY journey_date`,
      [tenantId, from, to],
      { name: 'report.occupancy' },
    );
  }

  /** Cancellations per day they happened, with the refunds actually granted. */
  cancellationsDaily(
    tenantId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ date: string; cancelledCount: number; refundedMinor: number }[]> {
    return this.db.query(
      `SELECT to_char((created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS "date",
              count(*)::int AS "cancelledCount",
              coalesce(sum(refund_minor), 0)::bigint AS "refundedMinor"
         FROM cancellations
        WHERE tenant_id = $1 AND (created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`,
      [tenantId, from, to, this.tz],
      { name: 'report.cancellations' },
    );
  }

  /** Bookings made in the period, and how many of them are now cancelled. */
  async bookingsAndCancelled(
    tenantId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ total: number; cancelled: number }> {
    const row = await this.db.queryOne<{ total: string; cancelled: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE status = 'cancelled') AS cancelled
         FROM bookings
        WHERE tenant_id = $1 AND (created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3`,
      [tenantId, from, to, this.tz],
      { name: 'report.cancellationRate' },
    );
    return { total: Number(row?.total ?? 0), cancelled: Number(row?.cancelled ?? 0) };
  }

  /** Confirmed sales by local hour of the day. */
  peakHours(tenantId: string, from: LocalDate, to: LocalDate): Promise<unknown[]> {
    return this.db.query(
      `SELECT extract(hour FROM created_at AT TIME ZONE $4)::int AS "hour",
              count(*)::int AS "bookingCount", coalesce(sum(total_minor), 0)::bigint AS "grossMinor"
         FROM bookings
        WHERE tenant_id = $1 AND status = 'confirmed'
          AND (created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3
        GROUP BY 1 ORDER BY 1`,
      [tenantId, from, to, this.tz],
      { name: 'report.peakHour' },
    );
  }
}
