import { z } from 'zod';

import { isLocalDate } from '@kernel';

/**
 * Shared query-string fragments. Query values always arrive as strings, so
 * these parse them into domain values (LocalDate, boolean, number) once, at
 * the edge, instead of each handler re-parsing `'1'` or a date by hand.
 */

/** A calendar date, `YYYY-MM-DD`. */
export const localDateQuery = z
  .string()
  .refine(isLocalDate, { message: 'Expected a calendar date, YYYY-MM-DD' });

/** A `?flag=1` style switch: '1' / 'true' mean on; absent means off. */
export const queryFlag = z
  .enum(['0', '1', 'true', 'false'])
  .optional()
  .transform((v) => v === '1' || v === 'true');

/** Free text for a search box. */
export const searchText = z.string().trim().max(120);

/** Both ends required; `from` may not be after `to`. */
export const DateRangeQuerySchema = z
  .object({ from: localDateQuery, to: localDateQuery })
  .refine((v) => v.from <= v.to, { message: "'from' must not be after 'to'", path: ['from'] });
export type DateRangeQuery = z.infer<typeof DateRangeQuerySchema>;

/** Either end may be left open. */
export const OptionalDateRangeQuerySchema = z
  .object({ from: localDateQuery.optional(), to: localDateQuery.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "'from' must not be after 'to'",
    path: ['from'],
  });
export type OptionalDateRangeQuery = z.infer<typeof OptionalDateRangeQuerySchema>;

/** `?download=1` on a file URL endpoint: force a download instead of inline display. */
export const DownloadQuerySchema = z.object({ download: queryFlag });
export type DownloadQuery = z.infer<typeof DownloadQuerySchema>;

/** The original file name sent with a raw-body upload. */
export const fileNameQuery = z.string().trim().min(1).max(255).optional();
export const FileUploadQuerySchema = z.object({ fileName: fileNameQuery });
export type FileUploadQuery = z.infer<typeof FileUploadQuerySchema>;

/** A segment of a trip: boarding (`from`) and dropping (`to`) stop ids. */
export const SegmentQuerySchema = z.object({ from: z.string().uuid(), to: z.string().uuid() });
export type SegmentQuery = z.infer<typeof SegmentQuerySchema>;
