import { get, patch } from './client';

export interface Address { line1: string; line2?: string; city: string; state: string; pincode: string }
export interface Contact { name: string; phone: string; email?: string }
export interface OperatorProfile {
  slug: string; displayName: string; status: string; timezone: string; currency: string; locale: string;
  contactEmail: string; contactPhone: string | null; secondaryContact: Contact | null; address: Address | null;
  registeredAddress: string | null; legalName: string; gstin: string | null;
}
export interface PlatformInvoice {
  id: string; invoiceNumber: string; periodFrom: string; periodTo: string;
  lines: { kind: string; description: string; count: number; baseMinor: number; gstMinor: number }[];
  subtotalMinor: number; discountMinor: number; gstMinor: number; totalMinor: number; currency: string; createdAt: string;
}

export const operatorProfileApi = {
  get: () => get<OperatorProfile>('/v1/operator/profile'),
  update: (body: Partial<{ displayName: string; contactEmail: string; contactPhone: string; secondaryContact: Contact | null; address: Address; timezone: string }>) =>
    patch<{ ok: boolean }>('/v1/operator/profile', body),
  /** Bills Ticketly issued to you (plan, per-bus fees, commission). */
  invoices: () => get<{ items: PlatformInvoice[] }>('/v1/operator/platform-invoices'),
};
