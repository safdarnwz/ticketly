import { z } from 'zod';

/**
 * Auth request schemas. Zod is the single source of truth for both validation
 * and the inferred TypeScript types, so a schema change updates the handler
 * signature automatically.
 */
// Unified login: an email OR a mobile number, plus password. `identifier` is the
// canonical field; `email` is still accepted for backward compatibility.
export const LoginSchema = z
  .object({
    identifier: z.string().min(3).max(320).optional(),
    email: z.string().email().max(320).optional(),
    password: z.string().min(1).max(256),
  })
  .refine((v) => Boolean(v.identifier ?? v.email), {
    message: 'identifier or email is required',
    path: ['identifier'],
  });
export type LoginDto = z.infer<typeof LoginSchema>;

export const CheckIdentitySchema = z.object({
  identifier: z.string().min(3).max(320),
});
export type CheckIdentityDto = z.infer<typeof CheckIdentitySchema>;

export const RegisterCustomerSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().max(320),
  mobile: z.string().min(6).max(20),
  password: z.string().min(8).max(256),
});
export type RegisterCustomerDto = z.infer<typeof RegisterCustomerSchema>;

export const VerifyRegistrationSchema = z.object({
  email: z.string().email().max(320),
  code: z.string().regex(/^\d{4,8}$/),
});
export type VerifyRegistrationDto = z.infer<typeof VerifyRegistrationSchema>;

export const RequestOtpSchema = z.object({
  // phone (E.164-ish) or email
  identity: z.string().min(3).max(320),
  purpose: z.enum(['login', 'verify_phone', 'verify_email', 'password_reset']).default('login'),
});
export type RequestOtpDto = z.infer<typeof RequestOtpSchema>;

export const VerifyOtpSchema = z.object({
  identity: z.string().min(3).max(320),
  code: z.string().regex(/^\d{4,8}$/),
  fullName: z.string().min(1).max(120).optional(),
});

export const ResetPasswordSchema = z.object({
  identity: z.string().min(3).max(320),
  code: z.string().regex(/^\d{4,8}$/),
  newPassword: z.string().min(8).max(256),
});
export type ResetPasswordDto = z.infer<typeof ResetPasswordSchema>;
export type VerifyOtpDto = z.infer<typeof VerifyOtpSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10).max(4096),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
