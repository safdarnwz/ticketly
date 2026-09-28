import { get, patch, post, put, withIdempotency } from './client';

// Reviews
export interface PublicReview { id: string; rating: number; title: string | null; body: string | null; verified: boolean; createdAt: string; reply: string | null; repliedAt: string | null }
export interface OperatorReview extends PublicReview {
  routeId: string | null; routeName: string | null; pnr: string; journeyDate: string | null; status: string;
  reportReason: string | null; reportedAt: string | null;
  /** The bus the review is about — the one that ran the trip. */
  vehicleId?: string | null; busNumber?: string | null; liked?: string[];
}
export interface ReviewSummary { count: number; average: number; bayesian: number; distribution?: Record<string, number>; counts: Record<string, number>; unanswered: number; reported: number }
export type ReviewFilter = 'all' | 'unanswered' | 'low' | 'reported';
export const REPORT_REASONS = [
  { value: 'abusive', label: 'Abusive or offensive' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'not_a_traveller', label: 'Not about this journey' },
  { value: 'personal_data', label: 'Shares personal data' },
  { value: 'other', label: 'Something else' },
] as const;

/** What a traveller can say they liked about the bus (summed into "loved by travellers"). */
export const REVIEW_ASPECTS: { value: string; label: string }[] = [
  { value: 'cleanliness', label: 'Cleanliness' },
  { value: 'punctuality', label: 'Punctuality' },
  { value: 'comfort', label: 'Seat / sleep comfort' },
  { value: 'staff', label: 'Staff behaviour' },
  { value: 'ac', label: 'AC' },
  { value: 'driving', label: 'Driving' },
  { value: 'tracking', label: 'Live tracking' },
  { value: 'rest_stops', label: 'Rest-stop hygiene' },
];

export const reviewsApi = {
  forRoute: (routeId: string) =>
    get<{ summary: { count: number; average: number; bayesian: number; distribution: Record<string, number> }; reviews: PublicReview[] }>(`/v1/routes/${routeId}/reviews`),
  create: (bookingId: string, rating: number, title?: string, body?: string, liked: string[] = []) =>
    post<{ reviewId: string }>('/v1/reviews', { bookingId, rating, title, body, liked }, withIdempotency(`review-${bookingId}`)),
  /** The operator's own reviews, with a summary. */
  list: (opts: { filter: ReviewFilter; routeId?: string; vehicleId?: string; rating?: number; cursor?: string }) => {
    const q = new URLSearchParams({ filter: opts.filter });
    if (opts.routeId) q.set('routeId', opts.routeId);
    if (opts.vehicleId) q.set('vehicleId', opts.vehicleId);
    if (opts.rating) q.set('rating', String(opts.rating));
    if (opts.cursor) q.set('cursor', opts.cursor);
    return get<{ summary: ReviewSummary; items: OperatorReview[]; hasMore: boolean; nextCursor: string | null }>(`/v1/reviews?${q}`);
  },
  /** Public answer; an empty reply removes it. */
  reply: (id: string, reply: string) => put<{ ok: boolean }>(`/v1/reviews/${id}/reply`, { reply }),
  report: (id: string, reason: string, note?: string) => post<{ ok: boolean }>(`/v1/reviews/${id}/report`, { reason, note: note || undefined }),
};

// Support
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
/** Escalated to the platform's support team: waiting on it, answered, or closed by it. */
export type EscalationStatus = 'open' | 'answered' | 'closed';
/** 'escalation' (operator → platform) and 'platform' (platform → operator) are internal notes. */
export type AuthorKind = 'customer' | 'agent' | 'system' | 'escalation' | 'platform';
export interface Ticket {
  id: string; subject: string; category: string; priority: 'low' | 'normal' | 'high' | 'urgent'; status: TicketStatus;
  pnr: string | null; bookingId: string | null; customerName: string | null; customerPhone: string | null;
  assignedTo: string | null; assignedName: string | null; messages: number; lastAuthor: AuthorKind | null; lastMessageAt: string | null;
  escalationStatus: EscalationStatus | null; escalatedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface TicketMessage { id: string; authorKind: AuthorKind; authorId: string | null; authorName: string | null; body: string; createdAt: string }
export interface TicketQuery { status?: TicketStatus | 'active'; priority?: string; category?: string; assigned?: 'me' | 'none'; q?: string; escalated?: 1 }
export const supportApi = {
  list: (f: TicketQuery = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
    return get<{ tickets: Ticket[] }>(`/v1/support/tickets${q.size ? `?${q}` : ''}`);
  },
  get: (id: string) => get<{ ticket: Ticket; messages: TicketMessage[] }>(`/v1/support/tickets/${id}`),
  /** Staff may give a PNR instead of a booking id. */
  open: (body: { subject: string; body: string; category?: string; priority?: string; bookingId?: string; pnr?: string }) =>
    post<{ ticketId: string }>('/v1/support/tickets', body),
  /** The author is whoever is signed in. */
  reply: (id: string, body: string) => post<{ status: TicketStatus }>(`/v1/support/tickets/${id}/messages`, { body }),
  setStatus: (id: string, status: TicketStatus) => post<{ status: TicketStatus }>(`/v1/support/tickets/${id}/status`, { status }),
  update: (id: string, changes: { priority?: string; assignedTo?: string | null }) => patch<{ ok: boolean }>(`/v1/support/tickets/${id}`, changes),
  /** Hand it to the platform's support team (an internal note — the customer never sees it). */
  escalate: (id: string, reason: string, key: string) => post<{ escalationStatus: EscalationStatus }>(`/v1/support/tickets/${id}/escalate`, { reason }, withIdempotency(key)),
};

/** The platform's support desk: tickets operators escalated. */
export interface Escalation {
  id: string; tenantId: string; operatorName: string; subject: string; category: string; priority: Ticket['priority']; status: TicketStatus;
  escalationStatus: EscalationStatus; escalatedAt: string; escalatedByName: string | null; pnr: string | null; lastAuthor: AuthorKind | null; lastMessageAt: string | null;
}
export const escalationsApi = {
  list: (status: EscalationStatus | 'active') => get<{ items: Escalation[] }>(`/v1/admin/support/escalations?status=${status}`),
  get: (id: string) => get<{ ticket: Escalation; messages: Omit<TicketMessage, 'authorId'>[] }>(`/v1/admin/support/escalations/${id}`),
  reply: (id: string, body: string) => post<{ escalationStatus: 'answered' }>(`/v1/admin/support/escalations/${id}/messages`, { body }),
  close: (id: string) => post<{ escalationStatus: 'closed' }>(`/v1/admin/support/escalations/${id}/close`, {}),
};

// CMS + offers (Part 14)
export const cmsApi = {
  banners: () => get<{ items: { id: string; title: string; imageUrl: string; linkUrl: string | null; sortOrder: number }[] }>('/v1/content/banners'),
  offers: () => get<{ items: { code: string; title: string; description: string | null; couponCode: string | null; bannerUrl: string | null; validFrom: string; validTo: string }[] }>('/v1/content/offers'),
  page: (slug: string) => get<unknown>(`/v1/content/pages/${slug}`),
  upsertPage: ({ slug, ...body }: { slug: string; title: string; body: string; kind?: string; status?: 'draft' | 'published' }) =>
    put<unknown>(`/v1/content/admin/pages/${encodeURIComponent(slug)}`, body),
  upsertOffer: (body: { code: string; title: string; description?: string; couponCode?: string; validFrom: string; validTo: string }) =>
    put<{ id: string }>(`/v1/content/admin/offers/${encodeURIComponent(body.code)}`, body),
};
