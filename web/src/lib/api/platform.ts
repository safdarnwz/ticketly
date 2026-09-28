import { del, get, post, put } from './client';
import type { Theme, ThemePatch } from '../../theme/types';

// i18n / multi-currency (Part 15)
export const i18nApi = {
  convert: (amountMinor: number, from: string, to: string) =>
    get<{ amountMinor: number; formatted: string }>(`/v1/i18n/convert?amountMinor=${amountMinor}&from=${from}&to=${to}`),
  upsertTranslation: (locale: string, key: string, value: string) =>
    post<{ ok: boolean }>('/v1/i18n/translations', { locale, key, value }),
  upsertRate: (base: string, quote: string, rateMicros: number, asOf: string) =>
    post<{ ok: boolean }>('/v1/i18n/fx-rates', { base, quote, rateMicros, asOf }),
};

// Privacy / DPDP (Part 15)
export const privacyApi = {
  myConsents: () => get<{ consents: Record<string, boolean> }>('/v1/privacy/consents'),
  setConsent: (purpose: string, granted: boolean) =>
    post<{ state: Record<string, boolean> }>('/v1/privacy/consents', { purpose, granted }),
  requestErasure: () => post<{ requestId: string }>('/v1/privacy/erasure-requests', {}),
  listErasure: (status?: string) => get<{ requests: unknown[] }>(`/v1/privacy/erasure-requests${status ? `?status=${status}` : ''}`),
  processErasure: (id: string) => post<{ status: string }>(`/v1/privacy/erasure-requests/${id}/process`, {}),
};

// Appearance / design system (Global Settings)
export interface AppearanceOverview {
  default: Theme;
  overrides: { scope: string; theme: ThemePatch; updatedAt: string }[];
}
export const appearanceApi = {
  effective: (role?: string) => get<{ theme: Theme }>(`/v1/appearance${role ? `?role=${role}` : ''}`),
  overview: () => get<AppearanceOverview>('/v1/appearance/admin/overview'),
  savePlatformDefault: (patch: ThemePatch) => put<{ theme: Theme }>('/v1/appearance/platform', patch),
  saveRole: (role: string, patch: ThemePatch) => put<{ theme: Theme }>(`/v1/appearance/role/${role}`, patch),
  resetRole: (role: string) => del<{ ok: boolean }>(`/v1/appearance/role/${role}`),
};
