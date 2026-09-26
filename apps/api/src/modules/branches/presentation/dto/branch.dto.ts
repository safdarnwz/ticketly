import { z } from 'zod';

import { WEEKDAYS } from '../../domain/working-hours';

export const CreateBranchSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(160),
  /** Short branch code, e.g. JPR-SND — letters, digits and dashes, stored in capitals. */
  code: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => /^[A-Z0-9][A-Z0-9-]{1,11}$/.test(v), { message: '2 to 12 letters, digits or dashes' })
    .optional(),
  address: z.string().trim().max(500).optional(),
  /** A mobile or a landline with STD code — 10 to 12 digits; empty clears it. */
  phone: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+?[\d\s-]{10,16}$/.test(v), {
      message: 'Enter a phone number with its STD code, e.g. 011 2345 6789',
    })
    .refine(
      (v) => v === '' || /^(\d{10,12})$/.test(v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')),
      {
        message: 'Enter a phone number with its STD code, e.g. 011 2345 6789',
      },
    )
    .optional(),
  managerUserId: z.string().uuid().optional(),
  /** #129 — per weekday; null or missing = closed that day. */
  workingHours: z
    .record(
      z.enum(WEEKDAYS),
      z
        .object({
          open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24-hour'),
          close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM, 24-hour'),
        })
        .nullable(),
    )
    .optional(),
});
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial();
export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;
