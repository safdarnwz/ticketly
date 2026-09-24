import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

/** PLATFORM-WIDE (see migration 0018) — one translation catalog + one set of FX rates, shared by the whole site. */
@Injectable()
export class I18nRepository {
  constructor(private readonly db: DatabaseService) {}

  async loadCatalog(locale: string): Promise<Record<string, string>> {
    const rows = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM translations WHERE locale = $1`,
      [locale],
      { name: 'i18n.loadCatalog' },
    );
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async upsertTranslation(locale: string, key: string, value: string): Promise<void> {
    await this.db.execute_(
      `INSERT INTO translations (id, locale, key, value)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (locale, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [newId(), locale, key, value],
      { name: 'i18n.upsertTranslation', primary: true },
    );
  }

  async latestRateMicros(base: string, quote: string): Promise<number | null> {
    const row = await this.db.queryOne<{ rate_micros: number }>(
      `SELECT rate_micros FROM fx_rates WHERE base_currency = $1 AND quote_currency = $2
        ORDER BY as_of DESC LIMIT 1`,
      [base, quote],
      { name: 'i18n.latestRate', primary: true },
    );
    return row ? Number(row.rate_micros) : null;
  }

  async upsertRate(base: string, quote: string, rateMicros: number, asOf: string): Promise<void> {
    await this.db.execute_(
      `INSERT INTO fx_rates (id, base_currency, quote_currency, rate_micros, as_of)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE SET rate_micros = EXCLUDED.rate_micros`,
      [newId(), base, quote, rateMicros, asOf],
      { name: 'i18n.upsertRate', primary: true },
    );
  }
}
