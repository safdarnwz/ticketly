import { z } from 'zod';

import { STATE_NORM_CATEGORIES } from '../../domain/state-norms';

const title = z.string().trim().min(3).max(80);
const body = z.string().trim().min(3).max(500);

export const CreateStateNormSchema = z.object({
  stateId: z.string().uuid(),
  category: z.enum(STATE_NORM_CATEGORIES),
  title,
  body,
});
export type CreateStateNormDto = z.infer<typeof CreateStateNormSchema>;

/** Change the wording, or switch a rule off / on (rules are never deleted). */
export const UpdateStateNormSchema = z
  .object({
    category: z.enum(STATE_NORM_CATEGORIES).optional(),
    title: title.optional(),
    body: body.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Change at least one of category, title, body, isActive',
  });
export type UpdateStateNormDto = z.infer<typeof UpdateStateNormSchema>;

export const ListStateNormsQuerySchema = z.object({
  stateId: z.string().uuid().optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListStateNormsQueryDto = z.infer<typeof ListStateNormsQuerySchema>;

/** The cities a route being drawn passes through (comma-separated ids). */
export const NormsForCitiesQuerySchema = z.object({
  cityIds: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().uuid()).min(1).max(50)),
});
export type NormsForCitiesQueryDto = z.infer<typeof NormsForCitiesQuerySchema>;
