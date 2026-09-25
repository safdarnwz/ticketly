import { get, post } from './client';

export interface CustomerProfile {
  id: string; fullName: string | null; email: string | null; phone: string | null;
  blacklistedAt: string | null; blacklistReason: string | null; preferences: Record<string, unknown>;
  totalBookings: number; totalSpentMinor: number; isFrequentTraveller: boolean;
}

export const crmApi = {
  search: (q: string) => get<{ items: CustomerProfile[] }>(`/v1/customers/search?q=${encodeURIComponent(q)}`),
  profile: (id: string) => get<CustomerProfile>(`/v1/customers/${id}`),
  bookings: (id: string) => get<{ items: { id: string; pnr: string; status: string; totalMinor: number; createdAt: string }[] }>(`/v1/customers/${id}/bookings`),
  blacklist: (id: string, reason: string) => post<{ ok: boolean }>(`/v1/customers/${id}/blacklist`, { reason }),
  unblacklist: (id: string) => post<{ ok: boolean }>(`/v1/customers/${id}/unblacklist`, {}),
  setPreferences: (id: string, preferences: Record<string, unknown>) => post<{ ok: boolean }>(`/v1/customers/${id}/preferences`, preferences),
};
