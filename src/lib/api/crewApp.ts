import { get, post, withIdempotency } from './client';

/** The crew app: the signed-in conductor/driver and the trips on their duty. */
export interface CrewDuty {
  id: string; tripId: string | null; startsAt: string; endsAt: string; attendance: 'pending' | 'present' | 'late' | 'absent';
  routeName: string | null; serviceCode: string | null; departsAt: string | null; arrivesAt: string | null;
  tripStatus: string | null; bus: string | null; seatsSold: number; seatsTotal: number | null;
}
export interface CrewMe {
  crew: { id: string; role: 'driver' | 'conductor' | 'attendant'; fullName: string; phone: string | null; employeeCode: string | null; status: string };
  duties: CrewDuty[];
}
export interface ManifestRow {
  seatNumber: string; fullName: string; age: number | null; gender: string | null; pnr: string; contactPhone: string;
  boardingPoint: string | null; droppingPoint: string | null; fromSeq: number; boardsAt: string | null;
  ticketId: string | null; ticketStatus: 'valid' | 'boarded' | 'no_show' | 'cancelled' | string; ladiesSeat: boolean;
}
export const CREW_REPORT_TYPES = [
  { value: 'delay', label: 'Running late (traffic, weather…)' },
  { value: 'breakdown', label: 'Bus breakdown' },
  { value: 'fuel', label: 'Fuel problem' },
  { value: 'maintenance', label: 'Something needs fixing (AC, lights, seat…)' },
  { value: 'cleaning', label: 'Bus needs cleaning' },
  { value: 'complaint', label: 'Passenger complaint / feedback' },
  { value: 'other', label: 'Something else' },
] as const;
export const SOS_KINDS = [
  { value: 'medical', label: 'Medical emergency' },
  { value: 'security', label: 'Security / police' },
  { value: 'accident', label: 'Accident' },
  { value: 'sos', label: 'Other emergency' },
] as const;

export const crewAppApi = {
  me: () => get<CrewMe>('/v1/crew/me'),
  markPresent: (dutyId: string) => post<{ attendance: string }>(`/v1/crew/me/duties/${dutyId}/attendance`, {}),
  manifest: (tripId: string) => get<{ passengers: ManifestRow[] }>(`/v1/crew/trips/${tripId}/manifest`),
  board: (tripId: string, ticketId: string) => post<{ status: string; seatNumber: string; passenger?: string }>(`/v1/crew/trips/${tripId}/tickets/${ticketId}/board`, {}),
  scan: (tripId: string, boardingCode: string) => post<{ status: string; seatNumber: string; passenger?: string }>(`/v1/crew/trips/${tripId}/scan`, { boardingCode }),
  setStatus: (tripId: string, status: 'departed' | 'closed') => post<{ ok: boolean }>(`/v1/crew/trips/${tripId}/status`, { status }),
  report: (tripId: string, body: { type: string; description?: string; delayCategory?: string; delayMinutes?: number; lat?: number; lng?: number }, key: string) =>
    post<{ id: string; severity: string }>(`/v1/crew/trips/${tripId}/incidents`, body, withIdempotency(key)),
  sos: (tripId: string, body: { kind: string; lat?: number; lng?: number; description?: string }, key: string) =>
    post<{ id: string; severity: string }>(`/v1/crew/trips/${tripId}/sos`, body, withIdempotency(key)),
  lostItem: (tripId: string, body: { description: string; seatNumber?: string; storedAt?: string }, key: string) =>
    post<{ id: string }>(`/v1/crew/trips/${tripId}/lost-found`, body, withIdempotency(key)),
  ping: (tripId: string, body: { lat: number; lng: number; speedKmph: number; headingDeg?: number }) =>
    post<{ nextStopId: string | null; etaSeconds: number; delayMinutes: number }>(`/v1/crew/trips/${tripId}/ping`, body),
};
