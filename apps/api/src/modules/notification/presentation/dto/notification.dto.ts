import { z } from 'zod';

export const ChannelSchema = z.enum(['sms', 'email', 'whatsapp', 'push']);

export const UpsertTemplateSchema = z.object({
  eventType: z.string().trim().min(1).max(60),
  channel: ChannelSchema,
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(2000),
});
export type UpsertTemplateDto = z.infer<typeof UpsertTemplateSchema>;
