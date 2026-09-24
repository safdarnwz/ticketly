import { z } from 'zod';

import {
  AnnouncementAudience,
  AnnouncementSeverity,
  PageKind,
  PageStatus,
} from '../../domain/content';

const values = <T extends Record<string, string>>(o: T) =>
  Object.values(o) as [T[keyof T], ...T[keyof T][]];

export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/, 'lowercase letters, digits and hyphens');

export const SavePageSchema = z.object({
  kind: z.enum(values(PageKind)).optional(),
  title: z.string().trim().min(1).max(160),
  /** Markdown. */
  body: z.string().max(100_000).default(''),
  status: z.enum(values(PageStatus)).optional(),
});
export type SavePageDto = z.infer<typeof SavePageSchema>;

export const CreateBannerSchema = z.object({
  title: z.string().trim().min(1).max(160),
  /** From POST /content/admin/uploads?purpose=cms_banner. */
  imageFileId: z.string().uuid(),
  linkUrl: z.string().url().optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  activeFrom: z.string().datetime({ offset: true }).optional(),
  activeTo: z.string().datetime({ offset: true }).optional(),
});
export type CreateBannerDto = z.infer<typeof CreateBannerSchema>;

export const SaveOfferSchema = z.object({
  code: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  couponCode: z.string().trim().max(40).optional(),
  /** From POST /content/admin/uploads?purpose=offer_banner. */
  bannerFileId: z.string().uuid().optional(),
  validFrom: z.string().datetime({ offset: true }),
  validTo: z.string().datetime({ offset: true }),
});
export type SaveOfferDto = z.infer<typeof SaveOfferSchema>;

export const UploadQuerySchema = z.object({
  purpose: z.enum(['cms_banner', 'offer_banner']),
  fileName: z.string().max(200).optional(),
});
export type UploadQueryDto = z.infer<typeof UploadQuerySchema>;

export const CreateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  severity: z.enum(values(AnnouncementSeverity)).default('info'),
  audience: z.enum(values(AnnouncementAudience)).default('operators'),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
});
export type CreateAnnouncementDto = z.infer<typeof CreateAnnouncementSchema>;

export const PagesQuerySchema = z.object({ kind: z.enum(values(PageKind)).optional() });

export const SetBannerActiveSchema = z.object({ isActive: z.boolean() });
export type SetBannerActiveDto = z.infer<typeof SetBannerActiveSchema>;
