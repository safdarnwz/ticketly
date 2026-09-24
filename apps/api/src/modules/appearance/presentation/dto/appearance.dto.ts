import { z } from 'zod';

export const ThemePatchSchema = z.record(z.any());
export type ThemePatchDto = z.infer<typeof ThemePatchSchema>;

/** A role code (`admin`, `booking_clerk`, …); omitted = the platform default theme. */
export const ThemeQuerySchema = z.object({
  role: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,40}$/)
    .optional(),
});
export type ThemeQueryDto = z.infer<typeof ThemeQuerySchema>;
