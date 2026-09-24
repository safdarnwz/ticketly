import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode } from '@kernel';

import { convertMinor, formatMoney } from '../../domain/currency';
import { translate, resolveLocaleChain, type Catalogs } from '../../domain/translator';
import { I18nRepository } from '../../infrastructure/persistence/i18n.repository';

/**
 * Internationalisation & multi-currency display.
 *
 * Translations are ONE platform-wide catalog (see migration 0018);
 * resolution walks requested-locale → base-language → fallback. Currency
 * conversion uses the platform's latest quoted rate and the pure integer-minor
 * `convertMinor`, so a displayed foreign price never invents or loses a sub-unit.
 * All the resolution/rounding rules live in the pure domain; this just supplies
 * the catalogs and rates.
 */
@Injectable()
export class I18nService {
  private readonly fallback = 'en';

  constructor(private readonly repo: I18nRepository) {}

  async translate(
    locale: string,
    key: string,
    vars: Record<string, string | number> = {},
  ): Promise<string> {
    const locales = resolveLocaleChain(locale, this.fallback);
    const catalogs: Catalogs = {};
    for (const loc of locales) catalogs[loc] = await this.repo.loadCatalog(loc);
    return translate(catalogs, locale, key, vars, this.fallback);
  }

  async convert(
    amountMinor: number,
    from: string,
    to: string,
  ): Promise<{ amountMinor: number; formatted: string }> {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t) return { amountMinor, formatted: formatMoney(amountMinor, t) };
    const rate = await this.repo.latestRateMicros(f, t);
    if (rate === null)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: `No FX rate for ${f}→${t}` });
    const converted = convertMinor(amountMinor, f, t, rate);
    return { amountMinor: converted, formatted: formatMoney(converted, t) };
  }

  upsertTranslation(locale: string, key: string, value: string): Promise<void> {
    return this.repo.upsertTranslation(locale, key, value);
  }

  upsertRate(base: string, quote: string, rateMicros: number, asOf: string): Promise<void> {
    return this.repo.upsertRate(base.toUpperCase(), quote.toUpperCase(), rateMicros, asOf);
  }
}
