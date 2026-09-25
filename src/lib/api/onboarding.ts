import { get, post } from './client';

export interface OperatorApplication {
  firstName: string; lastName: string; email: string; mobile: string; designation?: string; password: string;
  companyName: string; companyType?: string; gstNumber?: string; panNumber?: string; registrationNumber?: string;
  officialEmail?: string; companyMobile?: string; website?: string;
  addressLine1?: string; addressLine2?: string; city?: string; state?: string; country?: string; pinCode?: string;
  bankAccountHolder?: string; bankAccountNumber?: string; bankIfsc?: string; bankName?: string;
  business?: { numberOfBuses?: number; busTypes?: string[]; cities?: string[]; yearsInBusiness?: number; dailyTrips?: number };
  documents?: Record<string, string>;
}

export const onboardingApi = {
  apply: (input: OperatorApplication) => post<{ applicationId: string; status: string }>('/v1/operators/apply', input),
  list: (status?: string) => get<{ applications: any[] }>(`/v1/admin/operator-applications${status ? `?status=${status}` : ''}`),
  get: (id: string) => get<Record<string, unknown>>(`/v1/admin/operator-applications/${id}`),
  approve: (id: string) => post<{ tenantId: string; operatorUserId: string; slug: string; consoleUrl: string }>(`/v1/admin/operator-applications/${id}/approve`, {}),
  reject: (id: string, reason: string) => post<{ ok: boolean }>(`/v1/admin/operator-applications/${id}/reject`, { reason }),
};
