import { z } from 'zod';

/** Shared master-data request schemas. Zod = validation + inferred types. */

const uuid = z.string().uuid();

export const CreateStopSchema = z.object({
  cityId: uuid,
  name: z.string().min(1).max(160),
  kind: z.enum(['boarding', 'dropping', 'both']).default('both'),
  landmark: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  pincode: z.string().max(12).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  contactPhone: z.string().max(20).optional(),
});
export type CreateStopDto = z.infer<typeof CreateStopSchema>;

const SeatCellSchema = z.object({
  number: z.string().min(1).max(6),
  deck: z.union([z.literal(0), z.literal(1)]),
  row: z.number().int().min(0),
  column: z.number().int().min(0),
  rowSpan: z.number().int().min(1).max(4).optional(),
  colSpan: z.number().int().min(1).max(4).optional(),
  type: z.enum(['seater', 'sleeper', 'semi_sleeper', 'crew']),
  ladiesOnly: z.boolean().optional(),
  bookable: z.boolean().optional(),
  position: z.enum(['front', 'aisle', 'window']).optional(),
});

export const SeatMapSchema = z.object({
  decks: z.number().int().min(1).max(2),
  rows: z.number().int().min(1).max(40),
  columns: z.number().int().min(1).max(12),
  seats: z.array(SeatCellSchema).min(1).max(120),
});

export const CreateSeatLayoutSchema = z.object({
  name: z.string().min(1).max(120),
  layout: SeatMapSchema,
});
export type CreateSeatLayoutDto = z.infer<typeof CreateSeatLayoutSchema>;

export const CreateVehicleTypeSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(40),
  isAc: z.boolean().default(false),
  seatLayoutId: uuid.optional(),
  amenityIds: z.array(uuid).optional(),
});
export type CreateVehicleTypeDto = z.infer<typeof CreateVehicleTypeSchema>;

export const CreateAmenitySchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  icon: z.string().max(120).optional(),
});
export type CreateAmenityDto = z.infer<typeof CreateAmenitySchema>;

const RouteStopSchema = z.object({
  stopId: uuid,
  sequence: z.number().int().min(0),
  distanceFromOriginM: z.number().int().min(0),
  departOffsetMin: z.number().int().min(0),
  dwellMin: z.number().int().min(0).max(240).optional(),
  canBoard: z.boolean().optional(),
  canAlight: z.boolean().optional(),
});

export const CreateRouteSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  originCityId: uuid,
  destCityId: uuid,
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  stops: z.array(RouteStopSchema).min(2).max(60),
});
export type CreateRouteDto = z.infer<typeof CreateRouteSchema>;
