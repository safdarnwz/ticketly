import { z } from 'zod';
import { fileNameQuery } from '@http';
import { APPLICATION_STATUSES } from '../../domain/application-status';

export const APPLICATION_DOC_TYPES = [
  'gst_certificate',
  'pan_card',
  'cancelled_cheque',
  'aadhaar',
  'business_registration',
  'fleet_list',
  'other',
] as const;

export const ApplyOperatorSchema = z.object({
  // Personal
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().max(320),
  mobile: z.string().min(6).max(20),
  designation: z.string().max(80).optional(),
  password: z.string().min(8).max(256),
  // Company
  companyName: z.string().min(1).max(160),
  companyType: z.string().max(80).optional(),
  gstNumber: z.string().max(20).optional(),
  panNumber: z.string().max(20).optional(),
  registrationNumber: z.string().max(60).optional(),
  officialEmail: z.string().email().max(320).optional(),
  companyMobile: z.string().max(20).optional(),
  website: z.string().max(200).optional(),
  // Address
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  country: z.string().max(80).optional(),
  pinCode: z.string().max(12).optional(),
  // Business
  business: z
    .object({
      numberOfBuses: z.number().int().min(0).optional(),
      busTypes: z.array(z.string()).optional(),
      cities: z.array(z.string()).optional(),
      yearsInBusiness: z.number().int().min(0).optional(),
      dailyTrips: z.number().int().min(0).optional(),
    })
    .partial()
    .optional(),
  // Payout bank account — vetted as part of THIS application review, so it
  // becomes the tenant's active payout account the moment they're approved
  // (no separate "add your bank account" step after onboarding). Any LATER
  // change goes through the approval-request flow instead (see
  // operator/bank-details endpoints) — this initial one does not, since the
  // whole application is already being reviewed by a human.
  bankAccountHolder: z.string().min(1).max(200).optional(),
  bankAccountNumber: z
    .string()
    .min(4)
    .max(34)
    .regex(/^[0-9]+$/)
    .optional(),
  bankIfsc: z
    .string()
    .length(11)
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/i)
    .optional(),
  bankName: z.string().max(120).optional(),
  // Documents (uploaded references / URLs)
  /** docType → fileId from POST /operators/apply/documents (URLs are no longer accepted). */
  documents: z.record(z.enum(APPLICATION_DOC_TYPES), z.string().uuid()).optional(),
});
export type ApplyOperatorDto = z.infer<typeof ApplyOperatorSchema>;

/** Used for reject, hold and reopen — a reason is always required. */
export const RejectSchema = z.object({
  reason: z.string().trim().min(10, 'Please give a reason of at least 10 characters').max(1000),
});
export const ApproveSchema = z
  .object({ note: z.string().trim().max(1000).optional() })
  .optional()
  .default({});
export type ApproveDto = z.infer<typeof ApproveSchema>;
export type RejectDto = z.infer<typeof RejectSchema>;

/** Raw-body document upload for an application: which document, and its file name. */
export const ApplicationDocumentQuerySchema = z.object({
  docType: z.enum(APPLICATION_DOC_TYPES),
  fileName: fileNameQuery,
});
export type ApplicationDocumentQueryDto = z.infer<typeof ApplicationDocumentQuerySchema>;

export const ListApplicationsQuerySchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
});
export type ListApplicationsQueryDto = z.infer<typeof ListApplicationsQuerySchema>;
