import { del, get, post, put, patch } from './client';

export interface Vehicle { id: string; registrationNo: string; vehicleTypeId: string; seatLayoutId?: string | null; status: string; verificationStatus?: string; verificationReason?: string | null; manufactureYear?: number | null; chassisNo?: string | null; engineNo?: string | null; fuelType?: string | null; registeredOwner?: string | null; make?: string; model?: string; photoUrl?: string | null; serviceNote?: string | null; permitType?: 'aitp' | 'stage_carriage' | 'state_tourist_permit' | 'contract_carriage' | null }
export type CrewStatus = 'active' | 'on_leave' | 'inactive';
export interface Crew { id: string; role: string; fullName: string; status: CrewStatus; licenceNo: string | null; licenceExpiresOn: string | null; phone: string | null; employeeCode: string | null; upcomingDuties: number }
export type CrewPatch = Partial<{ fullName: string; phone: string | null; licenceNo: string | null; licenceExpiresOn: string | null; employeeCode: string | null; status: CrewStatus }>;
export interface CrewRules { minRestMinutes: number; maxDailyDrivingMinutes: number; maxDutyMinutes: number; maxContinuousDrivingMinutes?: number }
export interface CrewAllowance { remainingDrivingMinutes: number; nextAvailableAt: string | null; rules: CrewRules }
export interface ComplianceRow { id: string; crewName: string; role: string; tripId: string | null; startsAt: string; endsAt: string; drivingMinutes: number; attendance: string; overrideReason: string | null; overrideConflicts: unknown[] | null; approvedBy: string | null }
export interface MaintenanceEntry { kind: string; description: string; odometerKm: number | null; costMinor: number; performedOn: string; nextDueOn: string | null }
export interface VehicleMedia { id: string; kind: string; caption: string | null; url: string | null }
export interface Renewals {
  days: number;
  documents: { vehicleId: string; registrationNo: string; docType: string; documentNo: string | null; expiresOn: string; daysLeft: number }[];
  licences: { crewId: string; fullName: string; licenceNo: string | null; expiresOn: string | null; daysLeft: number | null }[];
}
export const MAINTENANCE_KINDS = ['service', 'repair', 'inspection'] as const;
export interface Duty { id: string; crewId: string; crewName: string; crewRole: string; tripId: string | null; tripLabel: string | null; startsAt: string; endsAt: string; drivingMinutes: number; attendance: 'pending' | 'present' | 'late' | 'absent'; overrideReason: string | null }

export interface VehicleDocument {
  id: string; docType: string; documentNo: string | null; validFrom: string | null; expiresOn: string | null;
  /** pending / verified / rejected. */
  status: string; rejectionReason?: string | null; hasFile: boolean; fileName: string | null; issuer: string | null;
}
export interface VehicleDetail {
  vehicle: Vehicle;
  documents: VehicleDocument[];
  requiredDocTypes: string[];
  docLabels: Record<string, string>;
  compliance: { compliant: boolean; missing: string[]; pendingReview: string[]; rejected: string[]; expired: string[]; expiringSoon: string[]; readyForSubmission: boolean };
  approvalBlockers: string[];
  missingDetails: string[];
  canSubmit: boolean;
}
export type VehicleDetailsPatch = Partial<{ seatLayoutId: string; make: string; model: string; manufactureYear: number; chassisNo: string; engineNo: string; fuelType: string; registeredOwner: string }>;

export const fleetApi = {
  vehicle: (id: string) => get<VehicleDetail>(`/v1/fleet/vehicles/${id}`),
  updateVehicle: (id: string, changes: VehicleDetailsPatch) => patch<{ ok: boolean }>(`/v1/fleet/vehicles/${id}`, changes),
  /** Upload the document file itself (raw bytes), then record the document with its fileId. */
  uploadDocumentFile: (id: string, docType: string, file: File) =>
    post<{ fileId: string }>(`/v1/fleet/vehicles/${id}/documents/file?docType=${encodeURIComponent(docType)}&fileName=${encodeURIComponent(file.name)}`, file, { headers: { 'Content-Type': 'application/octet-stream' } }),
  addDocument: (id: string, input: { docType: string; documentNo?: string; validFrom?: string; expiresOn: string; issuer?: string; fileId?: string; fileName?: string }) =>
    post<{ id: string }>(`/v1/fleet/vehicles/${id}/documents`, input),
  submitVehicle: (id: string) => post<{ status: string }>(`/v1/fleet/vehicles/${id}/submit`, {}),
  withdrawVehicle: (id: string) => post<{ ok: boolean }>(`/v1/fleet/vehicles/${id}/withdraw`, {}),
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
  addMaintenance: (vehicleId: string, input: { kind: string; description: string; odometerKm?: number; costMinor?: number; performedOn: string; nextDueOn?: string }) =>
    post<{ ok: boolean }>(`/v1/fleet/vehicles/${vehicleId}/maintenance`, input),
  renewals: (days: number) => get<Renewals>(`/v1/fleet/expiring?days=${days}`),
  listMaintenance: (vehicleId: string) => get<{ items: MaintenanceEntry[] }>(`/v1/fleet/vehicles/${vehicleId}/maintenance`),
  listMedia: (vehicleId: string) => get<{ items: VehicleMedia[] }>(`/v1/fleet/vehicles/${vehicleId}/media`),
  addPhoto: (vehicleId: string, file: File, caption?: string) =>
    post<{ id: string }>(`/v1/fleet/vehicles/${vehicleId}/media?fileName=${encodeURIComponent(file.name)}${caption ? `&caption=${encodeURIComponent(caption)}` : ''}`, file, { headers: { 'Content-Type': 'application/octet-stream' } }),
  removePhoto: (vehicleId: string, mediaId: string) => del<{ ok: boolean }>(`/v1/fleet/vehicles/${vehicleId}/media/${mediaId}`),

  listCrew: (filter: { role?: string; status?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
    return get<{ items: Crew[] }>(`/v1/fleet/crew${qs ? `?${qs}` : ''}`);
  },
  updateCrew: (id: string, changes: CrewPatch) => patch<Crew>(`/v1/fleet/crew/${id}`, changes),
  allowance: (id: string) => get<CrewAllowance>(`/v1/fleet/crew/${id}/allowance`),
  crewRules: () => get<CrewRules>('/v1/fleet/crew-rules'),
  setCrewRules: (rules: CrewRules) => put<{ ok: boolean }>('/v1/fleet/crew-rules', rules),
  crewCompliance: (from: string, to: string) => get<{ items: ComplianceRow[] }>(`/v1/fleet/crew-compliance?from=${from}&to=${to}`),
  markAttendance: (dutyId: string, status: 'present' | 'absent') => post<{ attendance: string }>(`/v1/fleet/crew/duties/${dutyId}/attendance`, { status }),
  createCrew: (input: { role: string; fullName: string; phone?: string; licenceNo?: string; licenceExpiresOn?: string; employeeCode?: string }) =>
    post<{ id: string }>('/v1/fleet/crew', input),

  listDuties: () => get<{ duties: Duty[] }>('/v1/fleet/crew/duties'),
  assignDuty: (input: { crewId: string; tripId?: string; startsAt: string; endsAt: string; drivingMinutes: number; overrideReason?: string }) =>
    post<{ id: string }>('/v1/fleet/crew/duties', input),
  cancelDuty: (id: string) => post<{ ok: boolean }>(`/v1/fleet/crew/duties/${id}/cancel`, {}),
};
