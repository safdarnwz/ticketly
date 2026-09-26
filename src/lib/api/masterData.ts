import { get, post, patch, del } from './client';

export interface City { id: string; name: string; state?: string }
export interface Stop { id: string; name: string; kind: string; landmark?: string; address?: string; pincode?: string; isActive?: boolean; cityId?: string }
export interface RouteRow { id: string; code: string; name: string; status: string }
export interface RouteDetail extends RouteRow {
  totalDistanceKm: number; totalDurationMin: number;
  timetable: { stopId: string; sequence: number; arrivesOffsetMin: number; departsOffsetMin: number }[];
  segments: unknown[];
}
export interface SeatLayoutRow { id: string; name: string; decks?: number; totalSeats?: number }
export interface SeatLayoutVersion { versionNumber: number; name: string; changedBy: string | null; changeNote: string | null; createdAt: string; summary: { totalSeats: number; bookableSeats: number; seater: number; sleeper: number; semiSleeper: number; crewSeats: number; ladiesOnly: number; decks: number } }
export interface VehicleType { id: string; name: string; code: string; isAc: boolean }
export interface Amenity { id: string; code: string; name: string; icon?: string }

export const masterDataApi = {
  searchCities: (q: string) => get<{ items: City[] }>(`/v1/master-data/cities/search?q=${encodeURIComponent(q)}`),
  stopsForCity: (cityId: string) => get<{ items: Stop[] }>(`/v1/master-data/cities/${cityId}/stops`),
  createStop: (input: { cityId: string; name: string; kind: string; landmark?: string; address?: string; pincode?: string; contactPhone?: string }) =>
    post<{ id: string }>('/v1/master-data/stops', input),
  listAllStops: () => get<{ items: Stop[] }>('/v1/master-data/stops'),
  updateStop: (id: string, input: { name?: string; kind?: string; landmark?: string; address?: string; pincode?: string; contactPhone?: string }) =>
    patch<{ ok: boolean }>(`/v1/master-data/stops/${id}`, input),
  activateStop: (id: string) => post<{ ok: boolean }>(`/v1/master-data/stops/${id}/activate`, {}),
  deactivateStop: (id: string) => post<{ ok: boolean }>(`/v1/master-data/stops/${id}/deactivate`, {}),
  bulkImportStops: (rows: Array<{ cityId: string; name: string; kind?: string; landmark?: string; address?: string; pincode?: string }>) =>
    post<{ imported: number; failed: { row: number; error: string }[] }>('/v1/master-data/stops/bulk-import', { rows }),

  listRoutes: (status?: string) => get<{ items: RouteRow[] }>(`/v1/master-data/routes${status ? `?status=${status}` : ''}`),
  getRoute: (id: string) => get<RouteDetail>(`/v1/master-data/routes/${id}`),
  createRoute: (input: {
    code: string; name: string; originCityId: string; destCityId: string; startTime: string;
    stops: { stopId: string; sequence: number; distanceFromOriginM: number; departOffsetMin: number; dwellMin?: number }[];
  }) => post<{ id: string }>('/v1/master-data/routes', input),
  publishRoute: (id: string) => post<{ ok: boolean }>(`/v1/master-data/routes/${id}/publish`, {}),
  archiveRoute: (id: string) => post<{ ok: boolean }>(`/v1/master-data/routes/${id}/archive`, {}),
  duplicateRoute: (id: string, code: string, name: string) => post<{ id: string }>(`/v1/master-data/routes/${id}/duplicate`, { code, name }),

  listSeatLayouts: () => get<{ items: SeatLayoutRow[] }>('/v1/master-data/seat-layouts'),
  getSeatLayout: (id: string) => get<{ id: string; name: string; seatMap: unknown }>(`/v1/master-data/seat-layouts/${id}`),
  createSeatLayout: (input: { name: string; layout: unknown }) => post<{ id: string; name: string }>('/v1/master-data/seat-layouts', input),
  updateSeatLayout: (id: string, input: { name: string; layout: unknown }) => patch<{ summary: unknown }>(`/v1/master-data/seat-layouts/${id}`, input),
  validateSeatLayout: (layout: unknown) => post<{ summary: unknown }>('/v1/master-data/seat-layouts/validate', layout),
  seatLayoutUsage: (id: string) => get<{ vehicleCount: number }>(`/v1/master-data/seat-layouts/${id}/usage`),
  deleteSeatLayout: (id: string) => del<{ ok: boolean }>(`/v1/master-data/seat-layouts/${id}`),
  /** Derive window / aisle for every seat from the grid; saved as a new version. */
  autoSeatPositions: (id: string) => post<{ summary: unknown }>(`/v1/master-data/seat-layouts/${id}/seats/auto-positions`, {}),
  listSeatLayoutVersions: (id: string) => get<{ items: SeatLayoutVersion[] }>(`/v1/master-data/seat-layouts/${id}/versions`),
  restoreSeatLayoutVersion: (id: string, versionNumber: number) =>
    post<{ summary: unknown }>(`/v1/master-data/seat-layouts/${id}/versions/${versionNumber}/restore`, {}),

  listVehicleTypes: () => get<{ items: VehicleType[] }>('/v1/master-data/vehicle-types'),
  createVehicleType: (input: { name: string; code: string; isAc: boolean; seatLayoutId?: string; amenityIds?: string[] }) =>
    post<{ id: string }>('/v1/master-data/vehicle-types', input),

  listAmenities: () => get<{ items: Amenity[] }>('/v1/master-data/amenities'),
  createAmenity: (input: { code: string; name: string; icon?: string }) => post<{ id: string }>('/v1/master-data/amenities', input),
};
