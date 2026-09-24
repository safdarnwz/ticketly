import { Injectable } from '@nestjs/common';

import { requireTenantId, type LocalDate } from '@kernel';

import { ReportRepository } from '../../infrastructure/persistence/report.repository';

/**
 * Reporting — dashboards read the pre-aggregated materialized views
 * (refreshed by the worker), so a query is a small indexed lookup rather than a
 * live scan of bookings/ledger. Reads route to a replica (analytics never
 * informs a write decision). SQL lives in ReportRepository.
 */
@Injectable()
export class ReportingService {
  constructor(private readonly reports: ReportRepository) {}

  /** Operator revenue over a date range, with totals. */
  async revenue(from: LocalDate, to: LocalDate) {
    const series = await this.reports.revenueDaily(requireTenantId(), from, to);
    const totals = series.reduce(
      (acc, r) => ({
        grossMinor: acc.grossMinor + Number(r.grossMinor),
        bookings: acc.bookings + Number(r.bookings),
        seatsSold: acc.seatsSold + Number(r.seatsSold),
      }),
      { grossMinor: 0, bookings: 0, seatsSold: 0 },
    );
    return { series, totals };
  }

  /** Route occupancy leaderboard (last 30 days). */
  routePerformance(): Promise<unknown[]> {
    return this.reports.routePerformance(requireTenantId());
  }

  /** Daily occupancy per route. */
  occupancy(from: LocalDate, to: LocalDate): Promise<unknown[]> {
    return this.reports.occupancyDaily(requireTenantId(), from, to);
  }

  /** CSV export of the revenue series. */
  async revenueCsv(from: LocalDate, to: LocalDate): Promise<string> {
    const { series } = await this.revenue(from, to);
    const header = 'date,bookings,gross,cancelled,seats_sold';
    const lines = series.map((r) =>
      [
        r.date,
        r.bookings,
        Number(r.grossMinor) / 100,
        Number(r.cancelledMinor) / 100,
        r.seatsSold,
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  /**
   * Cancellations per day (by when they happened) with the refunds granted,
   * and the cancellation rate of the bookings made in the period.
   */
  async cancellationReport(from: LocalDate, to: LocalDate) {
    const tenantId = requireTenantId();
    const [series, { total, cancelled }] = await Promise.all([
      this.reports.cancellationsDaily(tenantId, from, to),
      this.reports.bookingsAndCancelled(tenantId, from, to),
    ]);
    return {
      series,
      cancellationRatePct: total > 0 ? Math.round((cancelled / total) * 1000) / 10 : 0,
      totalCancelled: cancelled,
      totalBookings: total,
    };
  }

  /** Which local hour of the day sells the most — for staffing / counter hours. */
  peakHourReport(from: LocalDate, to: LocalDate): Promise<unknown[]> {
    return this.reports.peakHours(requireTenantId(), from, to);
  }
}
