import { z } from 'zod';

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const vehicleDetails = {
  seatLayoutId: uuid.optional(),
  make: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().min(1).max(60).optional(),
  manufactureYear: z.number().int().min(1980).max(2100).optional(),
  chassisNo: z.string().trim().max(17).optional(),
  engineNo: z.string().trim().max(30).optional(),
  fuelType: z.enum(['diesel', 'cng', 'electric', 'petrol', 'hybrid', 'lng']).optional(),
  bodyColor: z.string().trim().max(30).optional(),
  registeredOwner: z.string().trim().max(120).optional(),
  registrationState: z.string().trim().max(40).optional(),
  registrationDate: localDate.optional(),
  gpsDeviceId: z.string().trim().max(60).optional(),
  hasAc: z.boolean().optional(),
};

export const CreateVehicleSchema = z.object({
  registrationNo: z.string().trim().min(4).max(20),
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

export const CreateCrewSchema = z.object({
  role: z.enum(['driver', 'conductor', 'attendant']),
  fullName: z.string().min(1).max(120),
  phone: z.string().max(20).optional(),
  licenceNo: z.string().max(40).optional(),
  licenceExpiresOn: localDate.optional(),
  employeeCode: z.string().max(40).optional(),
});
export type CreateCrewDto = z.infer<typeof CreateCrewSchema>;

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
  });
export type AssignDutyDto = z.infer<typeof AssignDutySchema>;

export const AttendanceSchema = z.object({ status: z.enum(['present', 'absent']) });
export const CrewRulesSchema = z.object({
  minRestMinutes: z.number().int().min(60).max(1440),
  maxDailyDrivingMinutes: z.number().int().min(60).max(1440),
  maxDutyMinutes: z.number().int().min(60).max(1440),
  maxContinuousDrivingMinutes: z.number().int().min(60).max(1440).optional(),
});

export const MaintenanceLogSchema = z.object({
  kind: z.enum(['service', 'repair', 'inspection']),
  description: z.string().min(1).max(500),
  odometerKm: z.number().int().min(0).optional(),
  costMinor: z.number().int().min(0).default(0),
  performedOn: localDate,
  nextDueOn: localDate.optional(),
});
export type MaintenanceLogDto = z.infer<typeof MaintenanceLogSchema>;

export const BulkImportVehiclesSchema = z.object({
  rows: z.array(CreateVehicleSchema).min(1).max(500),
});
export type BulkImportVehiclesDto = z.infer<typeof BulkImportVehiclesSchema>;

export const VehicleStatusSchema = z.object({
  status: z.enum(['active', 'maintenance', 'retired']),
});
export type VehicleStatusDto = z.infer<typeof VehicleStatusSchema>;

export const VehiclePermitTypeSchema = z.object({
  permitType: z.enum(['aitp', 'stage_carriage', 'state_tourist_permit', 'contract_carriage']),
});
export type VehiclePermitTypeDto = z.infer<typeof VehiclePermitTypeSchema>;

export const VehiclePhotoNoteSchema = z.object({
  serviceNote: z.string().trim().max(500).optional(),
});
export type VehiclePhotoNoteDto = z.infer<typeof VehiclePhotoNoteSchema>;
