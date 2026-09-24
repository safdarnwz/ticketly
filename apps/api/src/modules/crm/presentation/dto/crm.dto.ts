import { z } from 'zod';

export const BlacklistCustomerSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type BlacklistCustomerDto = z.infer<typeof BlacklistCustomerSchema>;

/** Saved travel preferences; merged into what is stored. Values are small scalars. */
export const CustomerPreferencesSchema = z
  .record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/),
    z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
  )
  .refine((v) => Object.keys(v).length <= 50, 'At most 50 preferences');
export type CustomerPreferencesDto = z.infer<typeof CustomerPreferencesSchema>;
