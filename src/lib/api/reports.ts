import { download, get, post } from './client';

/** "Today" is the operator's own calendar day. */
export interface ReportSummary {
  totalBookings: number; todayBookings: number; todaySeats: number; todayRevenueMinor: number;
  totalCancelled: number; todayCancelled: number;
  totalRevenueMinor: number;
  /** Customers paying for seats right now. */
  liveHolds: number; liveHoldSeats: number;
}

export interface PnlRow { id: string; label: string; trips: number; salesMinor: number; gstMinor: number; commissionMinor: number; expensesMinor: number; seatsSold: number; seatsTotal: number; netRevenueMinor: number; profitMinor: number; marginPct: number | null; occupancyPct: number; costPerSeatMinor: number | null }
export interface DispatchReport {
  period: { from: string; to: string };
  summary: { tripsRun: number; tripsCancelled: number; tripsWithActuals: number; onTime: number; avgDepartureDelayMin: number | null; onTimePct: number | null };
  delayed: { tripId: string; routeName: string; scheduled: string; actual: string; delayMin: number }[];
  buses: { bus: string; trips: number; scheduledHours: number | null }[];
  crew: { name: string; role: string; duties: number; late: number; absent: number; drivingMinutes: number }[];
}
export interface ForecastRow { routeName: string; journeyDate: string; tripId: string; currentSold: number; totalSeats: number; daysToDeparture: number; forecastSeats: number | null; forecastPct: number | null; samples: number; confidence: 'none' | 'low' | 'medium' | 'high' }

export const reportsApi = {
  summary: () => get<ReportSummary>('/v1/reports/summary'),
  revenue: (from: string, to: string) => get<{ series: { date: string; bookings: number; grossMinor: number; cancelledMinor: number; seatsSold: number }[]; totals: { grossMinor: number; bookings: number; seatsSold: number } }>(`/v1/reports/revenue?from=${from}&to=${to}`),
  occupancy: (from: string, to: string) => get<{ series: { date: string; routeId: string; routeName: string; trips: number; totalSeats: number; soldSeats: number; occupancyPct: number; revenueMinor: number }[] }>(`/v1/reports/occupancy?from=${from}&to=${to}`),
  routePerformance: () => get<{ routes: { routeId: string; routeName: string; routeCode: string; trips: number; totalCapacity: number; seatsSold: number; occupancyPct: number; revenueMinor: number }[] }>('/v1/reports/routes/performance'),
  cancellations: (from: string, to: string) => get<{ series: { date: string; cancelledCount: number; refundedMinor: number }[]; cancellationRatePct: number; totalCancelled: number; totalBookings: number }>(`/v1/reports/cancellations?from=${from}&to=${to}`),
  peakHours: (from: string, to: string) => get<{ items: { hour: number; bookingCount: number; grossMinor: number }[] }>(`/v1/reports/peak-hours?from=${from}&to=${to}`),
  downloadRevenueCsv: (from: string, to: string) => download(`/v1/reports/revenue.csv?from=${from}&to=${to}`, `revenue-${from}-to-${to}.csv`),
  pnl: (from: string, to: string, groupBy: 'trip' | 'route' | 'vehicle') => get<{ period: { from: string; to: string }; groupBy: string; items: PnlRow[] }>(`/v1/reports/pnl?from=${from}&to=${to}&groupBy=${groupBy}`),
  dispatch: (from: string, to: string) => get<DispatchReport>(`/v1/reports/dispatch?from=${from}&to=${to}`),
  forecast: (days: number) => get<{ items: ForecastRow[] }>(`/v1/reports/occupancy-forecast?days=${days}`),
  cancelSuggestions: (days: number, maxPct: number) => get<{ maxPct: number; items: ForecastRow[] }>(`/v1/reports/cancel-suggestions?days=${days}&maxPct=${maxPct}`),
  decideSuggestion: (tripId: string, decision: 'accepted' | 'rejected', reason: string) => post<{ tripId: string; decision: string }>(`/v1/trips/${tripId}/cancel-suggestion/decision`, { decision, reason }),
};
