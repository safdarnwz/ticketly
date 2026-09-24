import { z } from 'zod';

export const CheckPanFormatSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  pan: z.string().min(10).max(10),
});
export type CheckPanFormatDto = z.infer<typeof CheckPanFormatSchema>;

export const VerifyPanSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  pan: z.string().min(10).max(10),
  applicantName: z.string().optional(),
});
export type VerifyPanDto = z.infer<typeof VerifyPanSchema>;

export const StartAadhaarSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  aadhaarNumber: z.string().min(12).max(14),
});
export type StartAadhaarDto = z.infer<typeof StartAadhaarSchema>;

export const SubmitAadhaarOtpSchema = z.object({
  verificationId: z.string().uuid(),
  otp: z.string().min(4).max(8),
});
export type SubmitAadhaarOtpDto = z.infer<typeof SubmitAadhaarOtpSchema>;

export const VerifyBankAccountSchema = z.object({
  operatorApplicationId: z.string().uuid(),
  accountNumber: z.string().min(4).max(34),
  ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code'),
});
export type VerifyBankAccountDto = z.infer<typeof VerifyBankAccountSchema>;
