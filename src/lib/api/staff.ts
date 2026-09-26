import { del, download, get, patch, post, put } from './client';

export interface StaffRole { id: string; code: string; name: string; expiresAt: string | null }
export interface Staff {
  id: string; fullName: string; email: string | null; phone: string | null; status: 'active' | 'disabled';
  branchId: string | null; branchName: string | null; roles: StaffRole[];
  lastLoginAt: string | null; accessExpiresAt: string | null; managerId: string | null; managerName: string | null; createdAt: string;
}
export interface StaffActivity { action: string; resourceType: string; resourceId: string | null; changes: unknown; occurredAt: string }
export interface Role { id: string; code: string; name: string; description: string; isSystem: boolean; permissions: string[] }
export interface StaffPerformance { userId: string; fullName: string; branchName: string | null; bookings: number; seats: number; revenueMinor: number; cancelled: number; cancellationRatePct: number }

export const staffApi = {
  list: (f: { q?: string; status?: string; branchId?: string; roleId?: string; page: number }) => {
    const q = new URLSearchParams({ page: String(f.page) });
    for (const k of ['q', 'status', 'branchId', 'roleId'] as const) if (f[k]) q.set(k, f[k]!);
    return get<{ items: Staff[]; page: number; hasMore: boolean }>(`/v1/users?${q}`);
  },
  get: (id: string) => get<Staff & { activity: StaffActivity[] }>(`/v1/users/${id}`),
  roles: () => get<{ items: Role[] }>('/v1/roles'),
  invite: (body: { fullName: string; email: string; phone?: string; password: string; roles: string[] }) => post<{ id: string }>('/v1/users', body),
  update: (id: string, changes: { fullName?: string; phone?: string; status?: 'active' | 'disabled' }) => patch<{ ok: boolean }>(`/v1/users/${id}`, changes),
  addRole: (id: string, roleCode: string) => post<{ ok: boolean }>(`/v1/users/${id}/roles`, { roles: [roleCode] }),
  removeRole: (id: string, roleId: string) => del<{ ok: boolean }>(`/v1/users/${id}/roles/${roleId}`),
  setBranch: (id: string, branchId: string | null) => put<{ ok: boolean }>(`/v1/users/${id}/branch`, { branchId }),
  forceLogout: (id: string) => post<unknown>(`/v1/users/${id}/force-logout`, {}),
  exportCsv: () => download('/v1/users/export.csv', 'staff.csv'),
  performance: (from: string, to: string) => get<{ from: string; to: string; items: StaffPerformance[] }>(`/v1/users/performance?from=${from}&to=${to}`),
};
