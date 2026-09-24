import { z } from 'zod';

export const InviteUserSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().max(320),
  phone: z.string().max(20).optional(),
  password: z.string().min(8).max(256),
  roles: z.array(z.string().min(1)).min(1),
});
export type InviteUserDto = z.infer<typeof InviteUserSchema>;

export const UpdateUserSchema = z.object({
  fullName: z.string().min(1).max(120).optional(),
  phone: z.string().max(20).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

export const AssignRolesSchema = z.object({
  roles: z.array(z.string().min(1)),
});
export type AssignRolesDto = z.infer<typeof AssignRolesSchema>;

export const StaffAccessSchema = z.object({
  accessExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  loginWindow: z
    .object({
      days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      startMinute: z.number().int().min(0).max(1439),
      endMinute: z.number().int().min(0).max(1439),
    })
    .nullable()
    .optional(),
  managerId: z.string().uuid().nullable().optional(),
});
export type StaffAccessDto = z.infer<typeof StaffAccessSchema>;

/** Grant one role; `expiresAt` makes it a temporary permission. */
export const GrantRoleSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export type GrantRoleDto = z.infer<typeof GrantRoleSchema>;
