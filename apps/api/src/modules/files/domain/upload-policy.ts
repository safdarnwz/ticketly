import type { AllowedMime } from './file-validation';
import type { Folder } from '../infrastructure/storage/object-key';

/**
 * ============================================================================
 *  What may be uploaded where — one table, enforced server-side
 * ============================================================================
 *
 * The browser shows the same limits (and checks them first, for a fast
 * error), but THIS is the authority: type is decided from the file's bytes,
 * size is checked on the raw body, and visibility decides CDN (public) vs
 * short-lived signed links (private).
 */
const MB = 1024 * 1024;
const PDF: AllowedMime = 'application/pdf';
const IMAGES: AllowedMime[] = ['image/jpeg', 'image/png', 'image/webp'];
const WORD: AllowedMime[] = ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

export interface UploadPolicy {
  label: string;
  allowed: AllowedMime[];
  maxBytes: number;
  visibility: 'public' | 'private';
  folder: Folder;
  allowSvg?: boolean;
}

export const UPLOAD_POLICIES = {
  vehicle_document: { label: 'Bus document', allowed: [PDF, 'image/jpeg', 'image/png', ...WORD], maxBytes: 5 * MB, visibility: 'private', folder: 'vehicles' },
  vehicle_photo: { label: 'Bus photo', allowed: IMAGES, maxBytes: 5 * MB, visibility: 'public', folder: 'vehicles' },
  tenant_logo: { label: 'Logo', allowed: [...IMAGES, 'image/svg+xml'], maxBytes: 2 * MB, visibility: 'public', folder: 'branding', allowSvg: true },
  cms_banner: { label: 'Banner image', allowed: IMAGES, maxBytes: 5 * MB, visibility: 'public', folder: 'branding' },
  offer_banner: { label: 'Offer banner', allowed: IMAGES, maxBytes: 5 * MB, visibility: 'public', folder: 'branding' },
  operator_document: { label: 'Operator document', allowed: [PDF, 'image/jpeg', 'image/png', ...WORD], maxBytes: 5 * MB, visibility: 'private', folder: 'kyc' },
  expense_receipt: { label: 'Expense receipt', allowed: [PDF, 'image/jpeg', 'image/png', 'image/webp'], maxBytes: 5 * MB, visibility: 'private', folder: 'documents' },
  application_document: { label: 'Application document', allowed: [PDF, 'image/jpeg', 'image/png', ...WORD], maxBytes: 5 * MB, visibility: 'private', folder: 'kyc' },
} as const satisfies Record<string, UploadPolicy>;

export type UploadPurpose = keyof typeof UPLOAD_POLICIES;

/** Video uploads are not supported anywhere — buses have photos only. */
export const MAX_PHOTOS_PER_BUS = 10;

export function policyFor(purpose: string): UploadPolicy | null {
  return (UPLOAD_POLICIES as Record<string, UploadPolicy>)[purpose] ?? null;
}

export function humanSize(bytes: number): string {
  return bytes >= MB ? `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function allowedLabel(p: UploadPolicy): string {
  const names = p.allowed.map((m) => ({
    'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/svg+xml': 'SVG',
    'application/msword': 'DOC', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  } as Record<string, string>)[m] ?? m);
  return [...new Set(names)].join(', ');
}

/** Size check against the purpose's limit; message says exactly what the limit is. */
export function checkSize(p: UploadPolicy, sizeBytes: number): string | null {
  if (sizeBytes <= 0) return 'The file is empty';
  if (sizeBytes > p.maxBytes) return `${p.label} must be ${humanSize(p.maxBytes)} or smaller (this file is ${humanSize(sizeBytes)})`;
  return null;
}
