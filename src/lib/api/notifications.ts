import { get, post } from './client';

export interface NotificationTemplate {
  eventType: string;
  channel: 'sms' | 'email' | 'whatsapp' | 'push';
  subject: string | null;
  body: string;
  isActive: boolean;
}

export const notificationsApi = {
  listTemplates: () => get<{ items: NotificationTemplate[] }>('/v1/notifications/templates'),
  upsertTemplate: (input: { eventType: string; channel: NotificationTemplate['channel']; subject?: string; body: string }) =>
    post<{ ok: boolean }>('/v1/notifications/templates', input),
};
