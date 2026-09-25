import { get, post } from './client';

// Reviews (Part 14)
export const reviewsApi = {
  forRoute: (routeId: string) =>
    get<{ summary: { count: number; average: number; bayesian: number; distribution: Record<string, number> }; reviews: unknown[] }>(
      `/v1/routes/${routeId}/reviews`,
    ),
  create: (bookingId: string, rating: number, title?: string, body?: string) =>
    post<{ reviewId: string }>('/v1/reviews', { bookingId, rating, title, body }),
};

// Support (Part 14)
export interface Ticket {
  id: string; subject: string; category: string; priority: string; status: string;
  createdAt?: string; updatedAt?: string;
}
export const supportApi = {
  list: (status?: string) => get<{ tickets: Ticket[] }>(`/v1/support/tickets${status ? `?status=${status}` : ''}`),
  get: (id: string) => get<{ ticket: Ticket; messages: unknown[] }>(`/v1/support/tickets/${id}`),
  open: (body: { subject: string; body: string; category?: string; priority?: string; bookingId?: string }) =>
    post<{ ticketId: string }>('/v1/support/tickets', body),
  reply: (id: string, body: string, authorKind: 'customer' | 'agent' = 'agent') =>
    post<{ status: string }>(`/v1/support/tickets/${id}/messages`, { body, authorKind }),
  setStatus: (id: string, status: string) => post<{ status: string }>(`/v1/support/tickets/${id}/status`, { status }),
};

// CMS + offers (Part 14)
export const cmsApi = {
  banners: () => get<{ banners: { id: string; title: string; imageUrl: string; linkUrl: string | null; sortOrder: number }[] }>('/v1/content/banners'),
  offers: () => get<{ offers: { code: string; title: string; description: string | null; couponCode: string | null; bannerUrl: string | null; validFrom: string; validTo: string }[] }>('/v1/content/offers'),
  page: (slug: string) => get<unknown>(`/v1/content/pages/${slug}`),
  upsertPage: (body: { slug: string; title: string; body: string; status?: 'draft' | 'published' }) =>
    post<{ id: string }>('/v1/content/pages', body),
  upsertOffer: (body: { code: string; title: string; description?: string; couponCode?: string; validFrom: string; validTo: string }) =>
    post<{ id: string }>('/v1/content/offers', body),
};
