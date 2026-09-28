import { get, patch, post, put, withIdempotency } from './client';

export type AgentStatus = 'pending' | 'active' | 'suspended' | 'rejected';
export type BillingMode = 'prepaid' | 'postpaid';
export interface Agent {
  id: string; userId: string; code: string; name: string; contactName: string | null; contactPhone: string; contactEmail: string | null;
  gstin: string | null; pan: string | null; address: string | null; city: string | null; branchId: string | null;
  status: AgentStatus; statusReason: string | null; billingMode: BillingMode; commissionPct: number;
  creditLimitMinor: number; balanceMinor: number; lowBalanceAlertMinor: number; paymentTermsDays: number; createdAt: string;
  spendableMinor: number; lowBalance: boolean; bookings?: number; salesMinor?: number; commissionMinor?: number;
}
export interface AgentLedgerEntry { id: string; kind: string; amountMinor: number; balanceAfterMinor: number; bookingId: string | null; pnr: string | null; reference: string | null; note: string | null; createdAt: string }
export interface Slab { minMonthlySalesMinor: number; commissionPct: number }
export interface AgentStatement {
  period: { from: string; to: string }; openingBalanceMinor: number; salesMinor: number; refundsMinor: number; commissionMinor: number;
  receivedMinor: number; adjustmentsMinor: number; closingBalanceMinor: number; amountDueMinor: number; bookings: number;
}
export interface NewAgent {
  name: string; code?: string; contactName?: string; contactPhone: string; contactEmail?: string; gstin?: string; pan?: string;
  city?: string; branchId?: string; billingMode: BillingMode; commissionPct: number; creditLimitMinor?: number;
  lowBalanceAlertMinor?: number; paymentTermsDays?: number; loginEmail: string; password: string; activate?: boolean;
}

export const agentsApi = {
  list: (f: { status?: AgentStatus; search?: string } = {}) => {
    const q = new URLSearchParams();
    if (f.status) q.set('status', f.status);
    if (f.search) q.set('search', f.search);
    return get<{ items: Agent[] }>(`/v1/agents${q.size ? `?${q}` : ''}`);
  },
  get: (id: string) => get<Agent>(`/v1/agents/${id}`),
  /** `key` is made once per form, so a retried or double-clicked submit creates one agent. */
  create: (body: NewAgent, key: string) => post<{ agentId: string; code: string }>('/v1/agents', body, withIdempotency(key)),
  update: (id: string, body: Partial<Omit<NewAgent, 'loginEmail' | 'password' | 'code' | 'activate'>>) => patch<{ ok: boolean }>(`/v1/agents/${id}`, body),
  setStatus: (id: string, status: 'active' | 'suspended' | 'rejected', reason?: string) => post<{ ok: boolean }>(`/v1/agents/${id}/status`, { status, reason }),
  /** Money received: prepaid top-up or postpaid payment. The same reference twice changes nothing. */
  receipt: (id: string, body: { amountMinor: number; reference: string; note?: string }, key: string) =>
    post<{ balanceMinor: number; applied: boolean }>(`/v1/agents/${id}/receipts`, body, withIdempotency(key)),
  adjust: (id: string, body: { amountMinor: number; reason: string; reference?: string }, key: string) =>
    post<{ balanceMinor: number }>(`/v1/agents/${id}/adjustments`, body, withIdempotency(key)),
  ledger: (id: string, from?: string, to?: string) => get<{ items: AgentLedgerEntry[] }>(`/v1/agents/${id}/ledger${from && to ? `?from=${from}&to=${to}` : ''}`),
  statement: (id: string, from: string, to: string) => get<AgentStatement>(`/v1/agents/${id}/statement?from=${from}&to=${to}`),
  defaultSlabs: () => get<{ operatorDefaultSlabs: Slab[] }>('/v1/agents/commission-slabs'),
  setDefaultSlabs: (slabs: Slab[]) => put<{ ok: boolean }>('/v1/agents/commission-slabs', { slabs }),
  slabs: (id: string) => get<{ agentSlabs: Slab[]; operatorDefaultSlabs: Slab[]; currentRate: { pct: number; source: string; monthSalesMinor: number } }>(`/v1/agents/${id}/commission-slabs`),
  setSlabs: (id: string, slabs: Slab[]) => put<{ ok: boolean }>(`/v1/agents/${id}/commission-slabs`, { slabs }),
  complaints: (id: string) => get<{ items: AgentComplaint[] }>(`/v1/agents/${id}/complaints`),
  /** `key` is made once per form, so a double-clicked submit records one complaint. */
  raiseComplaint: (id: string, body: { category: ComplaintCategory; description: string; pnr?: string }, key: string) =>
    post<{ id: string }>(`/v1/agents/${id}/complaints`, body, withIdempotency(key)),
  decideComplaint: (id: string, complaintId: string, outcome: 'upheld' | 'dismissed', resolution: string, key: string) =>
    post<{ status: string }>(`/v1/agents/${id}/complaints/${complaintId}/decision`, { outcome, resolution }, withIdempotency(key)),
};

export type ComplaintCategory = 'overcharging' | 'wrong_booking' | 'misbehaviour' | 'fraud' | 'other';
export interface AgentComplaint {
  id: string; agentId: string; category: ComplaintCategory; description: string; bookingId: string | null; pnr: string | null;
  status: 'open' | 'upheld' | 'dismissed'; resolution: string | null; raisedByName: string | null; resolvedByName: string | null;
  createdAt: string; resolvedAt: string | null;
}
