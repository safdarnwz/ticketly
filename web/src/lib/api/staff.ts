import { del, download, get, patch, post, put } from './client';

export interface StaffRole { id: string; code: string; name: string; expiresAt: string | null }
export interface Staff {
  id: string; fullName: string; email: string | null; phone: string | null; status: 'active' | 'disabled';
  branchId: string | null; branchName: string | null; roles: StaffRole[];
  lastLoginAt: string | null; accessExpiresAt: string | null; loginWindow: LoginWindow | null; managerId: string | null; managerName: string | null; createdAt: string;
}
export interface StaffActivity { action: string; resourceType: string; resourceId: string | null; changes: unknown; occurredAt: string }
export interface Role { id: string; code: string; name: string; description: string; isSystem: boolean; permissions: string[]; holders?: number }
/** ISO weekdays 1=Mon…7=Sun; minutes after midnight (India time). An end before the start is an overnight shift. */
export interface LoginWindow { days: number[]; startMinute: number; endMinute: number }
export interface PermissionGroup { group: string; items: { code: string; label: string; grantable: boolean }[] }
export interface RoleTemplate { id: string; code: string; name: string; description: string; permissions: string[] }
export interface StaffAccess { accessExpiresAt?: string | null; loginWindow?: LoginWindow | null; managerId?: string | null }
export interface StaffPerformance { userId: string; fullName: string; branchName: string | null; bookings: number; seats: number; revenueMinor: number; cancelled: number; cancellationRatePct: number; targetBookings: number | null; targetRevenueMinor: number | null }
export interface StaffTarget { dailyBookings: number; dailyRevenueMinor: number | null; updatedAt: string }
export type WarningReason = 'low_sales' | 'high_cancellations' | 'conduct' | 'attendance' | 'other';
export const WARNING_REASONS: { value: WarningReason; label: string }[] = [
  { value: 'low_sales', label: 'Low sales' },
  { value: 'high_cancellations', label: 'Too many cancellations' },
  { value: 'conduct', label: 'Conduct' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'other', label: 'Other' },
];
export const reasonLabel = (r: string) => WARNING_REASONS.find((x) => x.value === r)?.label ?? r;
export interface StaffWarning { id: string; reason: WarningReason; note: string; issuedByName: string | null; issuedAt: string; acknowledgedAt: string | null }
export type StaffRecord = Staff & { activity: StaffActivity[]; warnings: StaffWarning[]; target: StaffTarget | null };
export interface StaffImportResult { imported: number; failed: { row: number; error: string }[]; created: { row: number; fullName: string; email: string; password: string }[] }

export const staffApi = {
  list: (f: { q?: string; status?: string; branchId?: string; roleId?: string; page: number }) => {
    const q = new URLSearchParams({ page: String(f.page) });
    for (const k of ['q', 'status', 'branchId', 'roleId'] as const) if (f[k]) q.set(k, f[k]!);
    return get<{ items: Staff[]; page: number; hasMore: boolean }>(`/v1/users?${q}`);
  },
  get: (id: string) => get<StaffRecord>(`/v1/users/${id}`),
  me: () => get<StaffRecord>('/v1/users/me'),
  acknowledgeWarning: (warningId: string) => post<{ ok: boolean }>(`/v1/users/me/warnings/${warningId}/acknowledge`, {}),
  setTarget: (id: string, target: { dailyBookings: number; dailyRevenueMinor: number | null }) => put<{ ok: boolean }>(`/v1/users/${id}/target`, target),
  clearTarget: (id: string) => del<{ ok: boolean }>(`/v1/users/${id}/target`),
  warn: (id: string, reason: WarningReason, note: string) => post<{ id: string }>(`/v1/users/${id}/warnings`, { reason, note }),
  importTemplate: () => download('/v1/users/import-template.csv', 'staff-upload-template.csv'),
  bulkImport: (rows: Record<string, string>[]) => post<StaffImportResult>('/v1/users/bulk-import', { rows }),
  roles: () => get<{ items: Role[] }>('/v1/roles'),
  invite: (body: { fullName: string; email: string; phone?: string; password: string; roles: string[] }) => post<{ id: string }>('/v1/users', body),
  update: (id: string, changes: { fullName?: string; phone?: string; status?: 'active' | 'disabled' }) => patch<{ ok: boolean }>(`/v1/users/${id}`, changes),
  /** Give one role; `expiresAt` makes it temporary. Giving a held role again changes its end date. */
  grantRole: (id: string, roleId: string, expiresAt: string | null) => put<{ ok: boolean }>(`/v1/users/${id}/roles/${roleId}`, { expiresAt }),
  setAccess: (id: string, access: StaffAccess) => put<{ ok: boolean }>(`/v1/users/${id}/access`, access),
  resetPassword: (id: string, password: string) => put<{ ok: boolean }>(`/v1/users/${id}/password`, { password }),
  permissionCatalogue: () => get<{ groups: PermissionGroup[] }>('/v1/roles/permissions'),
  roleTemplates: () => get<{ items: RoleTemplate[] }>('/v1/roles/templates'),
  applyTemplate: (templateId: string, body: { code?: string; name?: string }) => post<{ id: string }>(`/v1/roles/templates/${templateId}/apply`, body),
  createRole: (body: { code: string; name: string; description?: string; permissions: string[] }) => post<{ id: string }>('/v1/roles', body),
  setRolePermissions: (id: string, permissions: string[]) => put<{ ok: boolean }>(`/v1/roles/${id}/permissions`, { permissions }),
  duplicateRole: (id: string, body: { code: string; name: string }) => post<{ id: string }>(`/v1/roles/${id}/duplicate`, body),
  deleteRole: (id: string) => del<{ ok: boolean }>(`/v1/roles/${id}`),
  removeRole: (id: string, roleId: string) => del<{ ok: boolean }>(`/v1/users/${id}/roles/${roleId}`),
  setBranch: (id: string, branchId: string | null) => put<{ ok: boolean }>(`/v1/users/${id}/branch`, { branchId }),
  forceLogout: (id: string) => post<unknown>(`/v1/users/${id}/force-logout`, {}),
  exportCsv: () => download('/v1/users/export.csv', 'staff.csv'),
  performance: (from: string, to: string) => get<{ from: string; to: string; items: StaffPerformance[] }>(`/v1/users/performance?from=${from}&to=${to}`),
};
