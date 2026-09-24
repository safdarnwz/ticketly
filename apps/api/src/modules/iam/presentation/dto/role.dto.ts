import { z } from 'zod';

import type { Json } from '@kernel';

export const CreateRoleSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string().min(1)),
  conditions: z.record(z.string(), z.custom<Json>()).optional(),
});
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1)),
});
export type UpdateRolePermissionsDto = z.infer<typeof UpdateRolePermissionsSchema>;

/** Copy a role, with all its permissions, under a new code and name. */
export const DuplicateRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,40}$/),
  name: z.string().trim().min(2).max(80),
});
export type DuplicateRoleDto = z.infer<typeof DuplicateRoleSchema>;
