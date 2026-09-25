import { z } from 'zod';

import { WEBHOOK_EVENTS, type WebhookEventType } from '../../domain/webhook-event';
import { webhookUrlProblem } from '../../domain/webhook-target';

export const RegisterWebhookSchema = z.object({
  name: z.string().trim().min(2).max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .superRefine((url, ctx) => {
      const problem = webhookUrlProblem(url);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  /** Empty = every event in the catalogue. */
  eventTypes: z
    .array(z.enum(WEBHOOK_EVENTS as [WebhookEventType, ...WebhookEventType[]]))
    .max(20)
    .default([])
    .transform((events) => [...new Set(events)]),
});
export type RegisterWebhookDto = z.infer<typeof RegisterWebhookSchema>;
