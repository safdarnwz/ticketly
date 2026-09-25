import { get, post, patch } from './client';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** A missing or null day is closed; `close` before `open` runs past midnight. */
export type WorkingHours = Partial<Record<Weekday, { open: string; close: string } | null>>;

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  managerUserId: string | null;
  status: 'active' | 'inactive';
  workingHours: WorkingHours;
  createdAt: string;
  staffCount: number;
}

type BranchInput = { name?: string; address?: string; phone?: string; managerUserId?: string; workingHours?: WorkingHours };

export const branchesApi = {
  list: () => get<{ items: Branch[] }>('/v1/branches'),
  create: (input: BranchInput & { name: string }) => post<{ id: string }>('/v1/branches', input),
  update: (id: string, input: BranchInput) => patch<{ ok: boolean }>(`/v1/branches/${id}`, input),
  activate: (id: string) => post<{ ok: boolean }>(`/v1/branches/${id}/activate`, {}),
  deactivate: (id: string) => post<{ ok: boolean }>(`/v1/branches/${id}/deactivate`, {}),
};
