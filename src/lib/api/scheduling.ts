import { del, get, patch, post, put, withIdempotency } from './client';

export interface ServiceRow {
  id: string; code: string; routeId: string; vehicleTypeId: string; status: string;
  /** Minutes after midnight the bus leaves its origin. */
  startMinute?: number;
  /** weekdays are ISO: 1 = Monday … 7 = Sunday. */
  recurrence?: { frequency: 'daily' | 'weekly'; weekdays?: number[]; interval?: number; startDate: string; endDate: string };
}
export interface TripRow {
  id: string; routeId: string; routeName: string; journeyDate: string;
  departsAt: string; arrivesAt: string; totalSeats: number; status: string; occupancyPct: number;
  /** Paid seats, and seats a customer is paying for right now. */
  bookedSeats: number; heldSeats: number;
}

export type Recurrence = NonNullable<ServiceRow['recurrence']> & { exceptions?: string[]; additions?: string[] };
export interface CategoryQuota { seats?: number; pct?: number; releaseHours: number }
export interface SalesRules { otaReleasePct?: number | null; categoryQuotas?: { female?: CategoryQuota; senior?: CategoryQuota } }
export interface ServiceVersion { versionNumber: number; snapshot: { recurrence: Recurrence; startMinute: number; vehicleTypeId: string; defaultVehicleId: string | null }; note: string; createdAt: string }
export interface ExtraTripSuggestion { tripId: string; journeyDate: string; departsAt: string; routeName: string; serviceId: string; totalSeats: number; sold: number; waitingSeats: number }
export interface Blackout { date: string; reason: string; [k: string]: unknown }

/** Service upkeep: timetable edits (versioned), copies, extra trips, sales rules, route blackouts. */
export const serviceAdminApi = {
  update: (id: string, body: { startTime?: string; recurrence?: Recurrence; vehicleTypeId?: string; note?: string }) =>
    patch<{ version: number }>(`/v1/scheduling/services/${id}`, body),
  versions: (id: string) => get<{ items: ServiceVersion[] }>(`/v1/scheduling/services/${id}/versions`),
  restore: (id: string, versionNumber: number) => post<{ version: number }>(`/v1/scheduling/services/${id}/versions/${versionNumber}/restore`, {}),
  clone: (id: string, body: { code: string; startDate: string; endDate: string; startTime?: string; weekdays?: number[]; season?: boolean }, key: string) =>
    post<{ id: string }>(`/v1/scheduling/services/${id}/clone`, body, withIdempotency(key)),
  remove: (id: string) => del<{ tripsDeleted: number }>(`/v1/scheduling/services/${id}`),
  salesRules: (id: string) => get<SalesRules>(`/v1/scheduling/services/${id}/sales-rules`),
  setSalesRules: (id: string, rules: SalesRules) => put<SalesRules>(`/v1/scheduling/services/${id}/sales-rules`, rules),
  extraTrips: (id: string, body: { journeyDates: string[]; departureTime?: string; reason: string; openForSale?: boolean; ladiesSpecial?: boolean }, key: string) =>
    post<{ created: { tripId: string; journeyDate: string }[]; skipped: { journeyDate: string; reason: string }[] }>(`/v1/scheduling/services/${id}/extra-trips`, body, withIdempotency(key)),
  suggestions: () => get<{ items: ExtraTripSuggestion[] }>('/v1/scheduling/extra-trip-suggestions'),
  releaseForSale: (tripId: string) => post<{ ok: boolean }>(`/v1/scheduling/trips/${tripId}/release-inventory`, {}),
  blackouts: (routeId: string) => get<{ items: Blackout[] }>(`/v1/scheduling/routes/${routeId}/blackouts`),
  addBlackouts: (routeId: string, dates: string[], reason: string) =>
    post<{ dates: string[]; tripsCancelled: number; tripsWithBookings: unknown[] }>(`/v1/scheduling/routes/${routeId}/blackouts`, { dates, reason }),
  removeBlackouts: (routeId: string, dates: string[]) => post<{ removed: number }>(`/v1/scheduling/routes/${routeId}/blackouts/remove`, { dates }),
};

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

  /** One journey date (any status), or — no date — every trip still to leave. */
  listTrips: (date?: string) => get<{ items: TripRow[] }>(`/v1/scheduling/trips${date ? `?date=${date}` : ''}`),
};

export interface ChartOccupant {
  seatNumber: string; name: string; age: number | null; gender: string | null;
  bookingId: string; pnr: string; status: string;
  /** A customer is paying for this seat right now. */
  onHold: boolean; holdExpiresAt: string | null;
  fromSeq: number; toSeq: number; from: string | null; to: string | null;
  contactPhone: string | null; channel: string;
  ticketStatus: string | null;
}
export interface ChartSeat {
  seatNumber: string; seatType: string; deck: number; row: number; column: number; rowSpan: number; colSpan: number;
  ladiesOnly: boolean; blocked: boolean; bookable: boolean;
  occupants: ChartOccupant[];
}
export interface TripChart {
  trip: { id: string; routeId: string; journeyDate: string; departsAt: string; arrivesAt: string; totalSeats: number; status: string; vehicleId: string | null; hasRun: boolean; closedOnTrip?: string[]; closedByService?: string[] };
  stops: { sequence: number; stopId: string; name: string | null; arrivesAt: string; departsAt: string; canBoard: boolean; canAlight: boolean }[];
  layout: { decks: number; rows: number; columns: number };
  seats: ChartSeat[];
  totals: { seats: number; seatsWithPassengers: number; passengers: number; bookings: number; onHold: number; blocked: number; boarded: number; free: number };
}

export const tripOpsApi = {
  /** The reservation chart: layout, passengers seat by seat, holds, blocked seats, totals. */
  chart: (tripId: string) => get<TripChart>(`/v1/bookings/trips/${tripId}/chart`),
  blockSeats: (tripId: string, input: { seatNumbers: string[]; fromStopId: string; toStopId: string; block: boolean }) =>
    post<{ affected: number }>(`/v1/scheduling/trips/${tripId}/block-seats`, input),
  releaseHolds: (tripId: string, includePhoneHolds = false) =>
    post<{ released: number }>(`/v1/scheduling/trips/${tripId}/release-holds`, { includePhoneHolds }),
  remarks: (tripId: string) => get<{ items: { id: string; remark: string; createdAt: string; by: string | null }[] }>(`/v1/scheduling/trips/${tripId}/remarks`),
  addRemark: (tripId: string, remark: string) => post<{ ok: boolean }>(`/v1/scheduling/trips/${tripId}/remarks`, { remark }),
  /** Put another bus on the trip; passengers keep their seat type if the layout differs. */
  changeBus: (tripId: string, vehicleId: string, reason: string) =>
    post<{ changed: boolean; layoutChanged: boolean; seatMoves: { from: string; to: string; seatType: string }[]; bookingsAffected: number }>(
      `/v1/trips/${tripId}/vehicle`, { vehicleId, reason }, withIdempotency(`bus-${tripId}-${vehicleId}`),
    ),
  retime: (tripId: string, newDepartsAt: string, reason: string) =>
    post<{ oldDepartsAt: string; newDepartsAt: string; shiftMinutes: number }>(`/v1/scheduling/trips/${tripId}/retime`, { newDepartsAt, reason }),
  cancel: (tripId: string, reason: string) =>
    post<{ cancelledBookings: number; failed: number }>(`/v1/bookings/trips/${tripId}/cancel`, { reason }, withIdempotency(`cancel-trip-${tripId}`)),
  stopSales: (tripId: string) => post<{ ok: boolean }>(`/v1/bookings/trips/${tripId}/stop-sales`, {}),
  resumeSales: (tripId: string) => post<{ ok: boolean }>(`/v1/bookings/trips/${tripId}/resume-sales`, {}),
};
