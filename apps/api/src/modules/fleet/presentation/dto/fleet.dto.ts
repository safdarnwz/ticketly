import { z } from 'zod';
import { fileNameQuery, searchText } from '@http';
import {
  FUEL_TYPES,
  MAINTENANCE_KINDS,
  PERMIT_TYPES,
  VEHICLE_STATUSES,
} from '../../domain/vehicle';
import { ATTENDANCE_STATUSES, CREW_ROLES, CREW_STATUSES } from '../../domain/crew';
import { UPLOADABLE_DOC_TYPES, VERIFICATION_STATUSES } from '../../domain/vehicle-verification';

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const vehicleDetails = {
  seatLayoutId: uuid.optional(),
  make: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().min(1).max(60).optional(),
  manufactureYear: z.number().int().min(1980).max(2100).optional(),
  chassisNo: z.string().trim().max(17).optional(),
  engineNo: z.string().trim().max(30).optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  bodyColor: z.string().trim().max(30).optional(),
  registeredOwner: z.string().trim().max(120).optional(),
  registrationState: z.string().trim().max(40).optional(),
  registrationDate: localDate.optional(),
  gpsDeviceId: z.string().trim().max(60).optional(),
  hasAc: z.boolean().optional(),
};

/**
 * An Indian registration number, stored in one form: capitals, no spaces or
 * dashes — "rj 14 pa-1234" is RJ14PA1234. State series (RJ14PA1234,
 * DL1C1234) or Bharat series (22BH1234AA).
 */
export const registrationNo = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
  .refine(
    (v) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(v) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(v),
    {
      message: 'Enter a registration number like RJ14PA1234',
    },
  );

/** A 10-digit Indian mobile number, stored as its 10 digits. */
const mobile = z
  .string()
  .transform((v) => v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), { message: 'Enter a 10-digit mobile number' });

export const CreateVehicleSchema = z.object({
  registrationNo,
  vehicleTypeId: uuid,
  ...vehicleDetails,
});
export type CreateVehicleDto = z.infer<typeof CreateVehicleSchema>;

/** registrationNo is accepted ONLY so a changed value can be refused with a clear message; it is never applied. */
export const UpdateVehicleSchema = z.object({
  registrationNo: z.string().optional(),
  ...vehicleDetails,
});
export type UpdateVehicleDto = z.infer<typeof UpdateVehicleSchema>;

export const UploadDocumentSchema = z
  .object({
    docType: z.string().trim().min(2).max(40),
    documentNo: z.string().trim().max(60).optional(),
    validFrom: localDate.optional(),
    expiresOn: localDate,
    issuer: z.string().trim().max(120).optional(),
    fileName: z.string().max(200).optional(),
    /** Preferred: the id returned by POST /fleet/vehicles/:id/documents/file (raw upload). */
    fileId: z.string().uuid().optional(),
    /** Legacy: base64 / data URL in the JSON body (max 5 MB file). */
    contentBase64: z.string().min(8).max(7_100_000).optional(),
  })
  .refine((d) => !!d.fileId !== !!d.contentBase64, {
    message: 'Provide exactly one of fileId or contentBase64',
  });
export type UploadDocumentDto = z.infer<typeof UploadDocumentSchema>;
/** @deprecated kept for older clients — same shape as UploadDocumentSchema. */
export const UpsertDocumentSchema = UploadDocumentSchema;
export type UpsertDocumentDto = UploadDocumentDto;

export const ReasonSchema = z.object({
  reason: z.string().trim().min(10, 'Please give a reason of at least 10 characters').max(1000),
});
export type ReasonDto = z.infer<typeof ReasonSchema>;
export const OptionalNoteSchema = z
  .object({ reason: z.string().trim().max(1000).optional() })
  .optional()
  .default({});
export type OptionalNoteDto = z.infer<typeof OptionalNoteSchema>;

const crewDetails = {
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  phone: mobile.optional(),
  licenceNo: z
    .string()
    .transform((v) => v.replace(/[\s-]/g, '').toUpperCase())
    .refine((v) => /^[A-Z0-9]{6,20}$/.test(v), {
      message: 'Enter the licence number (6 to 20 letters and digits)',
    })
    .optional(),
  licenceExpiresOn: localDate.optional(),
  employeeCode: z.string().trim().min(1).max(40).optional(),
};

/** A driver drives only with a licence on file — number and expiry. */
export const CreateCrewSchema = z
  .object({ role: z.enum(CREW_ROLES), ...crewDetails })
  .refine((d) => d.role !== 'driver' || (d.licenceNo && d.licenceExpiresOn), {
    message: 'A driver needs a licence number and its expiry date',
    path: ['licenceNo'],
  });
export type CreateCrewDto = z.infer<typeof CreateCrewSchema>;

/** Edit a crew member; null clears an optional detail. Status puts them on leave or inactive. */
export const UpdateCrewSchema = z
  .object({
    fullName: crewDetails.fullName.optional(),
    phone: mobile.nullable().optional(),
    licenceNo: crewDetails.licenceNo.unwrap().nullable().optional(),
    licenceExpiresOn: localDate.nullable().optional(),
    employeeCode: z.string().trim().min(1).max(40).nullable().optional(),
    status: z.enum(CREW_STATUSES).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to change' });
export type UpdateCrewDto = z.infer<typeof UpdateCrewSchema>;

export const AssignDutySchema = z
  .object({
    crewId: uuid,
    tripId: uuid.optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    drivingMinutes: z.number().int().min(0).max(1440),
    /** Manager approval to break rest/driving/length rules (e.g. emergency double duty). Never allows an overlap. */
    overrideReason: z.string().trim().min(10).max(300).optional(),
  })
  .refine((d) => Date.parse(d.endsAt) > Date.parse(d.startsAt), {
    message: 'Duty end must be after its start',
  })
  .refine((d) => d.drivingMinutes <= (Date.parse(d.endsAt) - Date.parse(d.startsAt)) / 60_000, {
    message: 'Driving minutes cannot exceed the duty length',
  })
  .refine((d) => Date.parse(d.endsAt) > Date.now(), {
    message: 'This duty has already ended — only current or future duties can be assigned',
    path: ['endsAt'],
  });
export type AssignDutyDto = z.infer<typeof AssignDutySchema>;

export const AttendanceSchema = z.object({ status: z.enum(ATTENDANCE_STATUSES) });
export const CrewRulesSchema = z.object({
  minRestMinutes: z.number().int().min(60).max(1440),
  maxDailyDrivingMinutes: z.number().int().min(60).max(1440),
  maxDutyMinutes: z.number().int().min(60).max(1440),
  maxContinuousDrivingMinutes: z.number().int().min(60).max(1440).optional(),
});

export const MaintenanceLogSchema = z
  .object({
    kind: z.enum(MAINTENANCE_KINDS),
    description: z.string().trim().min(3, 'Say what was done, in at least 3 characters').max(500),
    odometerKm: z.number().int().min(0).max(5_000_000).optional(),
    /** Up to ₹1 crore for one job. */
    costMinor: z.number().int().min(0).max(1_000_000_000).default(0),
    performedOn: localDate,
    nextDueOn: localDate.optional(),
  })
  .refine((d) => !d.nextDueOn || d.nextDueOn > d.performedOn, {
    message: 'The next service must be due after the day this work was done',
    path: ['nextDueOn'],
  });
export type MaintenanceLogDto = z.infer<typeof MaintenanceLogSchema>;

export const BulkImportVehiclesSchema = z.object({
  rows: z.array(CreateVehicleSchema).min(1).max(500),
});
export type BulkImportVehiclesDto = z.infer<typeof BulkImportVehiclesSchema>;

export const VehicleStatusSchema = z.object({
  status: z.enum(VEHICLE_STATUSES),
});
export type VehicleStatusDto = z.infer<typeof VehicleStatusSchema>;

export const VehiclePermitTypeSchema = z.object({
  permitType: z.enum(PERMIT_TYPES),
});
export type VehiclePermitTypeDto = z.infer<typeof VehiclePermitTypeSchema>;

export const VehiclePhotoNoteSchema = z.object({
  serviceNote: z.string().trim().max(500).optional(),
});
export type VehiclePhotoNoteDto = z.infer<typeof VehiclePhotoNoteSchema>;

export const ListVehiclesQuerySchema = z.object({
  status: z.enum(VEHICLE_STATUSES).optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  search: searchText.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListVehiclesQueryDto = z.infer<typeof ListVehiclesQuerySchema>;

/** Platform verification queue. */
export const VerificationQueueQuerySchema = z.object({
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  search: searchText.optional(),
});
export type VerificationQueueQueryDto = z.infer<typeof VerificationQueueQuerySchema>;

/** Raw-body upload of one compliance document. */
export const VehicleDocumentUploadQuerySchema = z.object({
  docType: z.enum(UPLOADABLE_DOC_TYPES),
  fileName: fileNameQuery,
});
export type VehicleDocumentUploadQueryDto = z.infer<typeof VehicleDocumentUploadQuerySchema>;

/** Raw-body upload of one bus photo (videos are not supported). */
export const VehiclePhotoUploadQuerySchema = z.object({
  kind: z.literal('photo').default('photo'),
  fileName: fileNameQuery,
  caption: z.string().trim().max(200).optional(),
});
export type VehiclePhotoUploadQueryDto = z.infer<typeof VehiclePhotoUploadQuerySchema>;

export const ListCrewQuerySchema = z.object({
  role: z.enum(CREW_ROLES).optional(),
  status: z.enum(CREW_STATUSES).optional(),
});
export type ListCrewQueryDto = z.infer<typeof ListCrewQuerySchema>;
