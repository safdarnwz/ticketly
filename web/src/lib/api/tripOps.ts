import { download, get, post, put, withIdempotency } from './client';

export interface Quota { id: string; seatNumber: string; holderType: 'agent' | 'branch'; holderId: string; holderName: string | null; releaseAt: string; releasedAt: string | null; releaseReason: string | null; consumedAt: string | null }
export interface PartnerSync {
  tripId: string; selling: boolean; departed: boolean;
  seats: { total: number; freeForPartners: number; freeNow: number; partnerSold: number; partnerHolding: number };
  partners: { partnerId: string; name: string; receiving: boolean; paused: boolean; commissionPct: number | null }[];
  issues: { code: 'closed_on_service' | 'closed_on_trip' | 'no_partner' | 'sold_out'; message: string }[];
}
export interface WaitlistEntry { id: string; seatCount: number; contactPhone: string; status: string; notifiedAt: string | null; createdAt: string; fromStop: string; toStop: string }
export const EXPENSE_CATEGORIES = ['diesel', 'cng', 'toll', 'driver_bata', 'cleaner_bata', 'parking', 'permit_fee', 'state_tax', 'repair', 'food', 'cleaning', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export interface Expense { id: string; category: ExpenseCategory; amountMinor: number; note: string | null; receiptFileId: string | null; incurredAt: string; voidedAt: string | null; voidReason: string | null; createdBy: string | null }
export interface TripPnl { salesMinor: number; gstMinor: number; commissionMinor: number; commissionGstMinor: number; expensesMinor: number; seatsSold: number; seatsTotal: number; netRevenueMinor: number; profitMinor: number; marginPct: number | null; occupancyPct: number; costPerSeatMinor: number }
export interface TripForecast { currentSold: number; totalSeats: number; daysToDeparture: number; forecastSeats: number | null; forecastPct: number | null; samples: number; confidence: string }
export const CHANNELS = [
  { key: 'ota', label: 'OTAs (redBus, Paytm…)' },
  { key: 'agent', label: 'Travel agents' },
  { key: 'direct_web', label: 'Your website & app' },
  { key: 'phone', label: 'Phone bookings' },
] as const;
export type Channel = (typeof CHANNELS)[number]['key'];

/** Per-trip controls beside the chart: who may sell which seats, the waitlist, and the bus's money. */
export const tripOpsExtraApi = {
  quotas: (tripId: string, all = false) => get<{ items: Quota[] }>(`/v1/trips/${tripId}/quotas${all ? '?all=1' : ''}`),
  allocate: (tripId: string, body: { seatNumbers: string[]; holderType: 'agent' | 'branch'; holderId: string; releaseMinutesBefore: number }, key: string) =>
    post<{ allocated: number; releaseAt: string }>(`/v1/trips/${tripId}/quotas`, body, withIdempotency(key)),
  allocatePercent: (tripId: string, body: { percent: number; holderType: 'agent' | 'branch'; holderId: string; releaseMinutesBefore: number }, key: string) =>
    post<{ allocated: number; releaseAt: string }>(`/v1/trips/${tripId}/quotas/percentage`, body, withIdempotency(key)),
  release: (tripId: string, seatNumbers: string[], reason: string, key: string) =>
    post<{ released: number }>(`/v1/trips/${tripId}/quotas/release`, { seatNumbers, reason }, withIdempotency(key)),
  /** Is this trip reaching the OTAs: seats partners see now, partner sold/holding, and what blocks them. */
  partnerSync: (tripId: string) => get<PartnerSync>(`/v1/trips/${tripId}/partner-sync`),
  setClosedChannels: (tripId: string, closed: Channel[]) => put<{ ok: boolean; closed: Channel[] }>(`/v1/trips/${tripId}/closed-channels`, { closed }),
  /** Join the waitlist of a full trip: told by SMS if seats free up. The key keeps a double tap to one entry. */
  joinWaitlist: (tripId: string, body: { fromStopId: string; toStopId: string; seatCount: number; contactPhone: string; contactEmail?: string }, key: string, tenantId?: string) =>
    post<{ id: string; position?: number }>(`/v1/trips/${tripId}/waitlist`, body, { ...withIdempotency(key), ...(tenantId ? { headers: { 'idempotency-key': key, 'X-Tenant-Id': tenantId } } : {}) }),
  waitlist: (tripId: string) => get<{ items: WaitlistEntry[] }>(`/v1/trips/${tripId}/waitlist`),
  expenses: (tripId: string, includeVoided = true) => get<{ items: Expense[] }>(`/v1/trips/${tripId}/expenses${includeVoided ? '?includeVoided=1' : ''}`),
  /** Upload a receipt (raw bytes) first; pass the fileId with the expense. */
  uploadReceipt: (tripId: string, file: File) =>
    post<{ fileId: string; fileName: string }>(`/v1/trips/${tripId}/expenses/receipt?fileName=${encodeURIComponent(file.name)}`, file, { headers: { 'Content-Type': 'application/octet-stream' } }),
  openReceipt: (fileId: string) => download(`/v1/files/${fileId}`, 'receipt'),
  /** Take someone off the waitlist (staff read the number from the entry). */
  leaveWaitlist: (tripId: string, id: string, contactPhone: string) => post<{ ok: boolean }>(`/v1/trips/${tripId}/waitlist/${id}/leave`, { contactPhone }),
  addExpense: (tripId: string, body: { category: ExpenseCategory; amountMinor: number; note?: string; receiptFileId?: string }, key: string) =>
    post<{ id: string }>(`/v1/trips/${tripId}/expenses`, body, withIdempotency(key)),
  voidExpense: (tripId: string, expenseId: string, reason: string, key: string) =>
    post<{ ok: boolean }>(`/v1/trips/${tripId}/expenses/${expenseId}/void`, { reason }, withIdempotency(key)),
  pnl: (tripId: string) => get<TripPnl>(`/v1/trips/${tripId}/pnl`),
  forecast: (tripId: string) => get<TripForecast>(`/v1/trips/${tripId}/occupancy-forecast`),
};
