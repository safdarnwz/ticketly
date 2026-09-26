import { z } from 'zod';

const mobile = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))
  .refine((v) => v === '' || /^[6-9]\d{9}$/.test(v), { message: 'Enter a 10-digit mobile number' })
  .transform((v) => v || undefined);

export const InviteUserSchema = z.object({
  fullName: z.string().trim().min(2, 'At least 2 characters').max(120),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: mobile.optional(),
  password: z.string().min(8).max(256),
  roles: z.array(z.string().min(1)).min(1),
});
export type InviteUserDto = z.infer<typeof InviteUserSchema>;

export const UpdateUserSchema = z.object({
  fullName: z.string().trim().min(2, 'At least 2 characters').max(120).optional(),
  phone: mobile.optional(),
  status: z.enum(['active', 'disabled']).optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

/** An admin sets a new password for a staff member (they are signed out everywhere). */
export const ResetStaffPasswordSchema = z.object({ password: z.string().min(8).max(256) });
export type ResetStaffPasswordDto = z.infer<typeof ResetStaffPasswordSchema>;

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

export const StaffListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  branchId: z.string().uuid().optional(),
  roleId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StaffListQueryDto = z.infer<typeof StaffListQuerySchema>;

/** `branchId: null` takes the staff member off any branch. */
export const StaffBranchSchema = z.object({ branchId: z.string().uuid().nullable() });
export type StaffBranchDto = z.infer<typeof StaffBranchSchema>;
