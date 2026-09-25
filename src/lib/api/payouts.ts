import { get, patch, post } from './client';

export interface BankDetails {
  onFile: boolean;
  accountHolder?: string;
  accountNumberMasked?: string;
  ifsc?: string;
  bankName?: string;
  updatedAt?: string;
  pendingRequest?: { accountHolder: string; accountNumberMasked: string; ifsc: string; submittedAt: string } | null;
}

export interface BankChangeRequest {
  id: string;
  tenantId: string;
  tenantName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
  createdAt: string;
}

export interface PayoutInstruction {
  id: string;
  tenantId: string;
  settlementId: string;
  amountMinor: number;
  currency: string;
  beneficiaryName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  status: 'pending' | 'in_batch' | 'sent' | 'confirmed' | 'failed';
  createdAt: string;
}

export const bankDetailsApi = {
  get: () => get<BankDetails>('/v1/operator/bank-details'),
  set: (input: { accountHolder: string; accountNumber: string; ifsc: string; bankName?: string }) =>
    patch<{ ok: boolean }>('/v1/operator/bank-details', input),
};

export const payoutsApi = {
  pending: () => get<{ items: PayoutInstruction[] }>('/v1/admin/tenants/payouts/pending'),
  all: () => get<{ items: PayoutInstruction[] }>('/v1/admin/tenants/payouts'),
  generateBankFile: () => post<{ csv: string; count: number; totalMinor: number; instructionIds: string[] }>('/v1/admin/tenants/payouts/bank-file', {}),
  markSent: (ids: string[]) => post<{ ok: boolean }>('/v1/admin/tenants/payouts/mark-sent', { ids }),
  markConfirmed: (id: string) => post<{ ok: boolean }>(`/v1/admin/tenants/payouts/${id}/mark-confirmed`, {}),
  markFailed: (id: string, reason: string) => post<{ ok: boolean }>(`/v1/admin/tenants/payouts/${id}/mark-failed`, { reason }),
  pendingBankChanges: () => get<{ items: BankChangeRequest[] }>('/v1/admin/tenants/bank-changes/pending'),
  approveBankChange: (id: string) => post<{ ok: boolean }>(`/v1/admin/tenants/bank-changes/${id}/approve`, {}),
  rejectBankChange: (id: string, reason: string) => post<{ ok: boolean }>(`/v1/admin/tenants/bank-changes/${id}/reject`, { reason }),
};
