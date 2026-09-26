import { get, post } from './client';

export interface NotificationTemplate {
  eventType: string;
  channel: 'sms' | 'email' | 'whatsapp' | 'push';
  subject: string | null;
  body: string;
  isActive: boolean;
}

export const notificationsApi = {
  /** Templates, and the catalogue of events with the placeholders each fills in. */
  listTemplates: () => get<{ items: NotificationTemplate[]; catalogue: Record<string, { label: string; placeholders: string[] }> }>('/v1/notifications/templates'),
  upsertTemplate: (input: { eventType: string; channel: NotificationTemplate['channel']; subject?: string; body: string }) =>
    post<{ ok: boolean }>('/v1/notifications/templates', input),
};
