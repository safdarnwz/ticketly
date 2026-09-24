import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Translation resolver
 * ============================================================================
 *
 * Resolves a message key for a locale against per-locale catalogs, with a
 * fallback chain (requested locale → base language → fallback locale → the key
 * itself) and `{placeholder}` interpolation. Pure and deterministic, so the
 * resolution order and interpolation are unit-testable and identical on server
 * and client.
 *
 *   translate(catalogs, 'hi-IN', 'ticket.subject', { pnr: 'YB12' })
 *     → tries hi-IN, then hi, then the fallback (en), then returns the raw key.
 */

export type Catalogs = Record<string, Record<string, string>>;

export function resolveLocaleChain(locale: string, fallback: string): string[] {
  const chain: string[] = [];
  const norm = locale.replace('_', '-');
  chain.push(norm);
  const base = norm.split('-')[0];
  if (base && base !== norm) chain.push(base);
  if (!chain.includes(fallback)) chain.push(fallback);
  const fbBase = fallback.split('-')[0];
  if (fbBase && !chain.includes(fbBase)) chain.push(fbBase);
  return chain;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function translate(
  catalogs: Catalogs,
  locale: string,
  key: string,
  vars: Record<string, string | number> = {},
  fallback = 'en',
): string {
  if (!key) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'translation key is required');
  for (const loc of resolveLocaleChain(locale, fallback)) {
    const cat = catalogs[loc];
    if (cat && typeof cat[key] === 'string') return interpolate(cat[key], vars);
  }
  return key; // last resort: the key itself (never throws in prod hot paths)
}

/** True when a key exists in any locale of the chain (for coverage checks). */
export function hasTranslation(catalogs: Catalogs, locale: string, key: string, fallback = 'en'): boolean {
  return resolveLocaleChain(locale, fallback).some((loc) => typeof catalogs[loc]?.[key] === 'string');
}
