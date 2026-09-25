import { get, post, del } from './client';

export interface Announcement {
  id: string; title: string; body: string; severity: 'info' | 'warning' | 'critical';
  audience: 'operators' | 'customers' | 'all'; startsAt: string; endsAt: string | null; createdAt: string;
}

export const announcementsApi = {
  listAll: () => get<{ items: Announcement[] }>('/v1/content/admin/announcements'),
  create: (input: { title: string; body: string; severity?: 'info' | 'warning' | 'critical'; audience?: 'operators' | 'customers' | 'all'; endsAt?: string }) =>
    post<{ id: string }>('/v1/content/admin/announcements', input),
  remove: (id: string) => del<{ ok: boolean }>(`/v1/content/admin/announcements/${id}`),
  activeForOperators: () => get<{ items: Announcement[] }>('/v1/content/announcements/operators'),
  activeForCustomers: () => get<{ items: Announcement[] }>('/v1/content/announcements/customers'),
};
