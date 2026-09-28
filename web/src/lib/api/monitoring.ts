import { get } from './client';

export type FeedStatus = 'all' | 'live' | 'confirmed' | 'cancelled' | 'expired' | 'completed';

export interface MonitoredBooking {
  id: string;
  pnr: string;
  tenantId: string;
  operatorName: string;
  operatorSlug: string;
  status: string;
  /** A customer is paying for these seats right now. */
  liveHold: boolean;
  holdExpiresAt: string | null;
  channel: string;
  soldBy: 'agent' | 'gds' | null;
  seatCount: number;
  totalMinor: number;
  paidMinor: number;
  currency: string;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  departsAt: string;
  from: string | null;
  to: string | null;
  /** Masked by the server. */
  contactPhone: string | null;
  contactEmail: string | null;
  /** Latest status of each document email: eticket / invoice → sent | failed | pending. */
  emails: Partial<Record<'eticket' | 'invoice', string>>;
}

export interface OperatorActivity {
  tenantId: string;
  operatorName: string;
  operatorSlug: string;
  operatorStatus: string;
  holdsLive: number;
  seatsOnHold: number;
  holdValueMinor: number;
  confirmed: number;
  seatsSold: number;
  grossMinor: number;
  cancelled: number;
  lastBookingAt: string | null;
}

export interface ActivityResponse {
  from: string;
  to: string;
  timeZone: string;
  totals: Omit<OperatorActivity, 'tenantId' | 'operatorName' | 'operatorSlug' | 'operatorStatus' | 'lastBookingAt'> & { operatorsActive: number };
  operators: OperatorActivity[];
}

export interface FeedFilters {
  from?: string;
  to?: string;
  tenantId?: string;
  status?: FeedStatus;
  channel?: string;
  pnr?: string;
}

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Platform admin: bookings across every operator (contacts masked). */
export const monitoringApi = {
  activity: (p: { from?: string; to?: string }) => get<ActivityResponse>(`/v1/admin/monitoring/bookings/activity${qs(p)}`),
  feed: (f: FeedFilters, cursor?: string, limit = 50) =>
    get<{ items: MonitoredBooking[]; hasMore: boolean; nextCursor: string | null }>(
      `/v1/admin/monitoring/bookings${qs({ ...f, status: f.status === 'all' ? undefined : f.status, cursor, limit })}`,
    ),
};
