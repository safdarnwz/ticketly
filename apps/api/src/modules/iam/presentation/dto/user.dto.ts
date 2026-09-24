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
