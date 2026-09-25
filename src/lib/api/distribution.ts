import { get, post, del } from './client';

export interface Webhook { id: string; name: string; url: string; eventTypes: string[]; isActive: boolean; createdAt: string }
export interface WebhookDelivery { id: string; eventType: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; deliveredAt: string | null; createdAt: string }

export const distributionApi = {
  catalogue: () => get<{ events: string[]; note: string }>('/v1/webhooks/catalogue'),
  list: () => get<{ items: Webhook[] }>('/v1/webhooks'),
  register: (input: { name: string; url: string; eventTypes?: string[] }) =>
    post<{ id: string; secret: string }>('/v1/webhooks', input),
  revoke: (id: string) => del<{ ok: boolean }>(`/v1/webhooks/${id}`),
  deliveries: (id: string) => get<{ items: WebhookDelivery[] }>(`/v1/webhooks/${id}/deliveries`),
};
