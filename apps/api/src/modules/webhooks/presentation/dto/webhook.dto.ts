import { z } from 'zod';

import { WEBHOOK_EVENTS, type WebhookEventType } from '../../domain/webhook-event';

export const RegisterWebhookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z.string().url().startsWith('https://', 'Webhook URLs must use https'),
  /** Empty = every event in the catalogue. */
  eventTypes: z
    .array(z.enum(WEBHOOK_EVENTS as [WebhookEventType, ...WebhookEventType[]]))
    .max(20)
    .default([]),
});
export type RegisterWebhookDto = z.infer<typeof RegisterWebhookSchema>;
