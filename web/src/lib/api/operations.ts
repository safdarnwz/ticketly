import { get, post, withIdempotency } from './client';

export const INCIDENT_TYPES = [
  { value: 'breakdown', label: 'Breakdown' }, { value: 'fuel', label: 'Fuel problem' }, { value: 'delay', label: 'Delay' }, { value: 'diversion', label: 'Diversion' },
  { value: 'accident', label: 'Accident' }, { value: 'medical', label: 'Medical emergency' }, { value: 'security', label: 'Security / police' },
  { value: 'complaint', label: 'Passenger complaint' }, { value: 'other', label: 'Other' },
] as const;
export const DELAY_CATEGORIES = ['traffic', 'breakdown', 'weather', 'accident', 'road_closure', 'police_check', 'passenger', 'other'] as const;
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved' | 'closed';

export interface Incident {
  id: string; trip_id: string | null; trip_label: string | null; type: string; severity: 'critical' | 'high' | 'normal'; status: IncidentStatus;
  description: string | null; delay_category: string | null; delay_minutes: number | null; diversion_via: string | null;
  reported_by_name: string | null; created_at: string; resolution_note?: string | null; overdue: boolean;
}
export interface LostItem {
  id: string; trip_id: string | null; trip_label: string | null; description: string; seat_number: string | null; stored_at: string | null;
  status: 'found' | 'claimed' | 'disposed'; found_at: string; claimant_name: string | null; claim_pnr: string | null; claimed_at: string | null; disposed_at: string | null;
}
export interface ShiftNote { id: string; note: string; createdAt: string; writtenBy: string | null }

export interface BusOnRoad { tripId: string; routeName: string; bus: string | null; departsAt: string; arrivesAt: string; lat: number | null; lng: number | null; speedKmph: number | null; nextStop: string | null; nextStopEtaAt: string | null; delayMinutes: number | null; lastPingAt: string | null }

export const operationsApi = {
  onTheRoad: () => get<{ items: BusOnRoad[] }>('/v1/tracking/fleet'),
  incidents: (f: { status?: string; tripId?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    return get<{ items: Incident[] }>(`/v1/incidents${qs ? `?${qs}` : ''}`);
  },
  reportIncident: (input: { tripId?: string; type: string; description?: string; delayCategory?: string; delayMinutes?: number; diversionVia?: string }, key: string) =>
    post<{ id: string; severity: string }>('/v1/incidents', input, withIdempotency(key)),
  moveIncident: (id: string, status: Exclude<IncidentStatus, 'open'>, note?: string) => post<{ id: string; status: string }>(`/v1/incidents/${id}/status`, { status, note }),

  lostItems: (status?: string) => get<{ items: LostItem[] }>(`/v1/lost-found${status ? `?status=${status}` : ''}`),
  logItem: (input: { tripId?: string; description: string; seatNumber?: string; storedAt?: string }, key: string) =>
    post<{ id: string }>('/v1/lost-found', input, withIdempotency(key)),
  claimItem: (id: string, input: { claimantName: string; pnr?: string }) => post<{ ok: boolean }>(`/v1/lost-found/${id}/claim`, input),
  disposeItem: (id: string) => post<{ ok: boolean }>(`/v1/lost-found/${id}/dispose`, {}),

  notes: (scope: 'dispatch' | 'branch', branchId?: string) => get<{ items: ShiftNote[] }>(`/v1/shift-notes?scope=${scope}${branchId ? `&branchId=${branchId}` : ''}`),
  addNote: (input: { scope: 'dispatch' | 'branch'; note: string; branchId?: string }, key: string) => post<{ ok: boolean }>('/v1/shift-notes', input, withIdempotency(key)),
};
