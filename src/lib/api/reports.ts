import { get } from './client';

export interface ReportSummary {
  totalBookings: number; todayBookings: number;
  totalCancelled: number; todayCancelled: number;
  totalRevenueMinor: number;
}

export const reportsApi = {
  summary: () => get<ReportSummary>('/v1/reports/summary'),
  revenue: (from: string, to: string) => get<{ series: { date: string; bookings: number; grossMinor: number; cancelledMinor: number; seatsSold: number }[]; totals: { grossMinor: number; bookings: number; seatsSold: number } }>(`/v1/reports/revenue?from=${from}&to=${to}`),
  occupancy: (from: string, to: string) => get<{ series: { date: string; routeId: string; trips: number; totalSeats: number; soldSeats: number; occupancyPct: number; revenueMinor: number }[] }>(`/v1/reports/occupancy?from=${from}&to=${to}`),
  routePerformance: () => get<{ routes: { routeId: string; routeName: string; routeCode: string; trips: number; totalCapacity: number; seatsSold: number; occupancyPct: number; revenueMinor: number }[] }>('/v1/reports/routes/performance'),
  cancellations: (from: string, to: string) => get<{ series: { date: string; cancelledCount: number; refundedMinor: number }[]; cancellationRatePct: number; totalCancelled: number; totalBookings: number }>(`/v1/reports/cancellations?from=${from}&to=${to}`),
  peakHours: (from: string, to: string) => get<{ items: { hour: number; bookingCount: number; grossMinor: number }[] }>(`/v1/reports/peak-hours?from=${from}&to=${to}`),
  revenueCsvUrl: (from: string, to: string) => `/v1/reports/revenue.csv?from=${from}&to=${to}`,
};
