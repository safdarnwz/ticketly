import { get, post, withIdempotency } from './client';

export interface ServiceRow { id: string; code: string; routeId: string; vehicleTypeId: string; status: string }
export interface TripRow {
  id: string; routeId: string; routeName: string; journeyDate: string;
  departsAt: string; arrivesAt: string; totalSeats: number; status: string; occupancyPct: number;
}

export const schedulingApi = {
  listServices: () => get<{ services: ServiceRow[] }>('/v1/scheduling/services'),
  createService: (input: {
    code: string; routeId: string; vehicleTypeId: string; defaultVehicleId?: string; startTime: string;
    recurrence: { frequency: 'daily' | 'weekly'; weekdays?: number[]; interval?: number; startDate: string; endDate: string };
  }) => post<{ id: string }>('/v1/scheduling/services', input),
  activate: (id: string) => post<{ trips: number }>(`/v1/scheduling/services/${id}/activate`, {}),
  pause: (id: string) => post<{ ok: boolean }>(`/v1/scheduling/services/${id}/pause`, {}),
  materialise: (id: string) => post<{ trips: number }>(`/v1/scheduling/services/${id}/materialise`, {}),
  previewDates: (input: { recurrence: unknown; from: string; to: string }) =>
    post<{ dates: string[] }>('/v1/scheduling/services/preview-dates', input),

  listTrips: () => get<{ items: TripRow[] }>('/v1/scheduling/trips'),
};

export const tripOpsApi = {
  cancel: (tripId: string, reason: string) =>
    post<{ cancelledBookings: number; failed: number }>(`/v1/bookings/trips/${tripId}/cancel`, { reason }, withIdempotency(`cancel-trip-${tripId}`)),
  stopSales: (tripId: string) => post<{ ok: boolean }>(`/v1/bookings/trips/${tripId}/stop-sales`, {}),
  resumeSales: (tripId: string) => post<{ ok: boolean }>(`/v1/bookings/trips/${tripId}/resume-sales`, {}),
};
