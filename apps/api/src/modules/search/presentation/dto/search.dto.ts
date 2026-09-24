import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const clock = z.string().regex(/^\d{2}:\d{2}$/, 'HH:mm');

export const SeatTypeSchema = z.enum(['seater', 'sleeper', 'semi_sleeper']);
export const SortKeySchema = z.enum(['price', 'departure', 'duration', 'rating']);

export const TripFilterSchema = z.object({
  minPriceMinor: z.number().int().min(0).optional(),
  maxPriceMinor: z.number().int().min(0).optional(),
  departAfter: clock.optional(),
  departBefore: clock.optional(),
  seatTypes: z.array(z.string()).optional(),
  amenities: z.array(z.string()).optional(),
  minRating: z.number().min(0).max(5).optional(),
  minSeats: z.number().int().min(1).optional(),
});

/** POST /search — direct trips, optionally narrowed to stops, filtered and sorted. */
export const SearchTripsSchema = z.object({
  originCityId: uuid,
  destCityId: uuid,
  journeyDate: date,
  seatType: SeatTypeSchema.optional(),
  fromStopId: uuid.optional(),
  toStopId: uuid.optional(),
  filter: TripFilterSchema.optional(),
  sort: SortKeySchema.default('departure'),
  sortDir: z.enum(['asc', 'desc']).optional(),
});
export type SearchTripsDto = z.infer<typeof SearchTripsSchema>;

/** POST /search/round-trip */
export const RoundTripSchema = z.object({
  originCityId: uuid,
  destCityId: uuid,
  onwardDate: date,
  returnDate: date,
  seatType: SeatTypeSchema.optional(),
  filter: TripFilterSchema.optional(),
  sort: SortKeySchema.default('departure'),
});
export type RoundTripDto = z.infer<typeof RoundTripSchema>;

/** POST /search/connecting — two-leg journeys via a hub (discovered unless given). */
export const ConnectingSearchSchema = z
  .object({
    originCityId: uuid,
    destCityId: uuid,
    journeyDate: date,
    hubCityId: uuid.optional(),
    minLayoverMin: z.number().int().min(0).max(1440).optional(),
    maxLayoverMin: z.number().int().min(0).max(1440).optional(),
  })
  .refine((v) => v.originCityId !== v.destCityId, {
    message: 'Origin and destination must differ',
    path: ['destCityId'],
  });
export type ConnectingSearchDto = z.infer<typeof ConnectingSearchSchema>;
