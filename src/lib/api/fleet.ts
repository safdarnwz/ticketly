import { get, post, put, patch } from './client';

export interface Vehicle { id: string; registrationNo: string; vehicleTypeId: string; status: string; make?: string; model?: string; photoUrl?: string | null; serviceNote?: string | null; permitType?: 'aitp' | 'stage_carriage' | 'state_tourist_permit' | 'contract_carriage' | null }
export interface Crew { id: string; role: string; fullName: string; status: string; licenceNo?: string; licenceExpiresOn?: string }
export interface Duty { id: string; crewId: string; crewName: string; tripId: string | null; startsAt: string; endsAt: string; drivingMinutes: number }

export const fleetApi = {
  listVehicles: (params: { status?: string; search?: string; page?: number; pageSize?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return get<{ items: Vehicle[]; total: number }>(`/v1/fleet/vehicles${suffix}`);
  },
  createVehicle: (input: { registrationNo: string; vehicleTypeId: string; seatLayoutId?: string; make?: string; model?: string; manufactureYear?: number }) =>
    post<{ id: string }>('/v1/fleet/vehicles', input),
  setVehicleStatus: (id: string, status: 'active' | 'maintenance' | 'retired') => post<{ ok: boolean }>(`/v1/fleet/vehicles/${id}/status`, { status }),
  setVehiclePermitType: (id: string, permitType: 'aitp' | 'stage_carriage' | 'state_tourist_permit' | 'contract_carriage') =>
    post<{ ok: boolean }>(`/v1/fleet/vehicles/${id}/permit-type`, { permitType }),
  setVehiclePhotoNote: (id: string, input: { photoUrl?: string; serviceNote?: string }) => patch<{ ok: boolean }>(`/v1/fleet/vehicles/${id}/photo-note`, input),
  bulkImportVehicles: (rows: Array<{ registrationNo: string; vehicleTypeId: string; seatLayoutId?: string; make?: string; model?: string }>) =>
    post<{ imported: number; failed: { row: number; error: string }[] }>('/v1/fleet/vehicles/bulk-import', { rows }),
  upsertDocument: (vehicleId: string, input: { docType: string; documentNo?: string; validFrom?: string; expiresOn: string; issuer?: string; fileUrl?: string }) =>
    put<{ ok: boolean }>(`/v1/fleet/vehicles/${vehicleId}/documents`, input),
  compliance: (vehicleId: string) => get<{ compliant: boolean; issues: unknown[] }>(`/v1/fleet/vehicles/${vehicleId}/compliance`),
  addMaintenance: (vehicleId: string, input: { kind: string; description: string; odometerKm?: number; costMinor?: number; performedOn: string; nextDueOn?: string }) =>
    post<{ ok: boolean }>(`/v1/fleet/vehicles/${vehicleId}/maintenance`, input),
  listMaintenance: (vehicleId: string) => get<{ items: unknown[] }>(`/v1/fleet/vehicles/${vehicleId}/maintenance`),

  listCrew: (role?: string) => get<{ items: Crew[] }>(`/v1/fleet/crew${role ? `?role=${role}` : ''}`),
  createCrew: (input: { role: string; fullName: string; phone?: string; licenceNo?: string; licenceExpiresOn?: string; employeeCode?: string }) =>
    post<{ id: string }>('/v1/fleet/crew', input),

  listDuties: () => get<{ duties: Duty[] }>('/v1/fleet/crew/duties'),
  assignDuty: (input: { crewId: string; tripId?: string; startsAt: string; endsAt: string; drivingMinutes: number }) =>
    post<{ id: string }>('/v1/fleet/crew/duties', input),
  cancelDuty: (id: string) => post<{ ok: boolean }>(`/v1/fleet/crew/duties/${id}/cancel`, {}),
};
