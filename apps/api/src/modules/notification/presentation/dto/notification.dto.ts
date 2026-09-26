import { z } from 'zod';

import { templateProblem } from '../../domain/template-catalogue';

export const ChannelSchema = z.enum(['sms', 'email', 'whatsapp', 'push']);

export const UpsertTemplateSchema = z
  .object({
    eventType: z.string().trim().min(1).max(60),
    channel: ChannelSchema,
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1, 'Write the message').max(2000),
  })
  .superRefine((t, ctx) => {
    const problem = templateProblem(t);
    if (problem) ctx.addIssue({ code: 'custom', path: [problem.field], message: problem.message });
  });
export type UpsertTemplateDto = z.infer<typeof UpsertTemplateSchema>;
