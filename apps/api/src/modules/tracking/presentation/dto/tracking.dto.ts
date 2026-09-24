import { z } from 'zod';

export const LocationPingSchema = z.object({
  tripId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKmph: z.number().min(0).max(200),
  headingDeg: z.number().min(0).max(360).optional(),
  distanceCoveredM: z.number().int().min(0),
});
export type LocationPingDto = z.infer<typeof LocationPingSchema>;
