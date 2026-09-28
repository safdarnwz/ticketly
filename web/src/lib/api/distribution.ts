import { get, post, put, del } from './client';

export interface Webhook { id: string; name: string; url: string; eventTypes: string[]; isActive: boolean; createdAt: string }
export interface WebhookDelivery { id: string; eventType: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; deliveredAt: string | null; createdAt: string }

export const distributionApi = {
  catalogue: () => get<{ events: string[]; testEvent: string; signature: string; retries: string }>('/v1/webhooks/catalogue'),
  list: () => get<{ items: Webhook[] }>('/v1/webhooks'),
  register: (input: { name: string; url: string; eventTypes?: string[] }) =>
    post<{ id: string; secret: string }>('/v1/webhooks', input),
  revoke: (id: string) => del<{ ok: boolean }>(`/v1/webhooks/${id}`),
  /** Sends a signed test event now and reports what the endpoint answered. */
  test: (id: string) => post<{ ok: boolean; responseStatus: number | null; error: string | null; latencyMs: number }>(`/v1/webhooks/${id}/test`, {}),
  deliveries: (id: string) => get<{ items: WebhookDelivery[] }>(`/v1/webhooks/${id}/deliveries`),
};

export interface OtaPartner { partnerId: string; code: string; name: string; kind: string; defaultCommissionPct: number | string; status: 'active' | 'paused' | null; commissionPct: number | string | null; updatedAt: string | null }
export interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; ipAllowlist: string[]; expiresAt: string | null }

/** OTA / GDS partners on the platform and this operator's agreement with each. */
export const partnersApi = {
  list: () => get<{ items: OtaPartner[] }>('/v1/gds-partners'),
  setAgreement: (partnerId: string, status: 'active' | 'paused', commissionPct: number) =>
    put<{ ok: boolean }>(`/v1/gds-partners/${partnerId}`, { status, commissionPct }),
};

/** Server-to-server keys (X-Api-Key). The secret is shown once, at creation. */
export const apiKeysApi = {
  list: () => get<{ items: ApiKey[] }>('/v1/api-keys'),
  create: (body: { name: string; scopes: string[]; ipAllowlist?: string[]; expiresAt?: string }) =>
    post<{ id: string; apiKey: string; prefix: string; warning: string }>('/v1/api-keys', body),
  revoke: (id: string) => del<void>(`/v1/api-keys/${id}`),
};
