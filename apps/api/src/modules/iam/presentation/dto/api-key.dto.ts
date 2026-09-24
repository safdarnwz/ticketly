import { z } from 'zod';

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1)).min(1),
  ipAllowlist: z.array(z.string().max(64)).optional(),
  expiresAt: z.string().datetime().optional(),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;
