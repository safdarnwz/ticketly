import { z } from 'zod';

import { invalidAllowlistEntries } from '../../../platform-settings';

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  /** Become the key's permissions — checked against what the issuer holds. */
  scopes: z.array(z.string().trim().min(1)).min(1, 'Pick at least one scope').max(50),
  ipAllowlist: z
    .array(z.string().trim().max(64))
    .max(20)
    .optional()
    .superRefine((ips, ctx) => {
      const bad = invalidAllowlistEntries(ips ?? []);
      if (bad.length)
        ctx.addIssue({ code: 'custom', message: `Not an IP address or range: ${bad.join(', ')}` });
    }),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .refine((v) => !v || Date.parse(v) > Date.now(), 'The expiry must be in the future'),
});
export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;
