import { get, post, patch } from './client';

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  managerUserId: string | null;
  status: 'active' | 'inactive';
  createdAt: string;
  staffCount: number;
}

export const branchesApi = {
  list: () => get<{ items: Branch[] }>('/v1/branches'),
  create: (input: { name: string; address?: string; phone?: string; managerUserId?: string }) =>
    post<{ id: string }>('/v1/branches', input),
  update: (id: string, input: { name?: string; address?: string; phone?: string; managerUserId?: string }) =>
    patch<{ ok: boolean }>(`/v1/branches/${id}`, input),
  activate: (id: string) => post<{ ok: boolean }>(`/v1/branches/${id}/activate`, {}),
  deactivate: (id: string) => post<{ ok: boolean }>(`/v1/branches/${id}/deactivate`, {}),
};
