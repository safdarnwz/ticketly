import { get, post } from './client';

export interface TenantRow {
  id: string; slug: string; displayName: string; status: string;
  contactEmail: string; suspendedReason: string | null; createdAt: string; consoleUrl: string;
}
export interface Plan { id: string; code: string; name: string; monthlyPrice: number; currency: string }

export interface ProvisionTenantInput {
  slug: string; legalName: string; displayName: string; contactEmail: string;
  contactPhone?: string; planCode?: string;
  owner: { fullName: string; email: string; password: string };
}

export interface TenantStats {
  totalBookings: number; todayBookings: number;
  totalCancelled: number; todayCancelled: number;
  totalRevenueMinor: number;
}
export interface PlatformAnalytics extends TenantStats {
  trend: { date: string; bookings: number; revenueMinor: number }[];
  operators: { active: number; suspended: number; total: number };
}
export interface CommissionOverride { model: string; percent: number; flatMinor: number; capMinor: number | null }
export interface PlatformSettings { defaultCommissionPercent: number; perBusFeeMinor: number; gstRatePercent: number; commissionGstRatePercent: number; smsFeeMinor: number; whatsappFeeMinor: number }

export const tenantsApi = {
  list: () => get<{ items: TenantRow[] }>('/v1/admin/tenants'),
  stats: (id: string) => get<TenantStats>(`/v1/admin/tenants/${id}/stats`),
  analytics: () => get<PlatformAnalytics>('/v1/admin/tenants/analytics'),
  getCommission: (tenantId: string) => get<{ override: CommissionOverride | null }>(`/v1/payments/admin/commission/${tenantId}`),
  setCommission: (input: { tenantId: string; model: 'percent' | 'flat' | 'percent_plus'; percent?: number; flatMinor?: number; capMinor?: number }) =>
    post<{ ok: boolean }>('/v1/payments/admin/commission', input),
  platformSettings: () => get<PlatformSettings>('/v1/admin/tenants/platform-settings'),
  setPlatformSettings: (input: Partial<PlatformSettings>) => post<{ ok: boolean }>('/v1/admin/tenants/platform-settings', input),
  plans: () => get<{ items: Plan[] }>('/v1/admin/tenants/plans'),
  createPlan: (input: { code: string; name: string; monthlyPrice: number; currency?: string; features?: Record<string, boolean>; quotas?: Record<string, number | null>; sortOrder?: number }) =>
    post<{ id: string }>('/v1/admin/tenants/plans', input),
  togglePlanActive: (id: string, isActive: boolean) => post<{ ok: boolean }>(`/v1/admin/tenants/plans/${id}/toggle-active`, { isActive }),
  changePlan: (tenantId: string, planId: string) => post<{ ok: boolean }>(`/v1/admin/tenants/${tenantId}/plan`, { planId }),
  provision: (input: ProvisionTenantInput) =>
    post<{ tenantId: string; ownerId: string; slug: string; consoleUrl: string }>('/v1/admin/tenants', input),
  suspend: (id: string, reason: string) => post<{ ok: boolean }>(`/v1/admin/tenants/${id}/suspend`, { reason }),
  activate: (id: string) => post<{ ok: boolean }>(`/v1/admin/tenants/${id}/activate`, {}),
};
