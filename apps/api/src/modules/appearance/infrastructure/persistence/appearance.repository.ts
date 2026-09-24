import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, type Json } from '@kernel';

import type { ThemePatch } from '../../domain/theme';

/**
 * Appearance persistence — PLATFORM-WIDE (see migration 0018). One row per
 * `scope`, where scope is a role code or '' for the platform-wide default.
 * This is the console's OWN theme (app.ticketly.com AND every operator's
 * app.<slug>.ticketly.com render with it) — no more per-operator override.
 * The stored value is a PARTIAL theme (only the overridden tokens); the
 * effective theme is resolved by layering default ← role at read time.
 */
@Injectable()
export class AppearanceRepository {
  constructor(private readonly db: DatabaseService) {}

  async getPatch(scope: string): Promise<ThemePatch | null> {
    const row = await this.db.queryOne<{ theme: ThemePatch }>(
      `SELECT theme FROM appearance_settings WHERE scope = $1`,
      [scope],
      { name: 'appearance.getPatch', primary: true },
    );
    return row ? row.theme : null;
  }

  async upsert(scope: string, patch: ThemePatch): Promise<void> {
    await this.db.execute_(
      `INSERT INTO appearance_settings (id, scope, theme)
       VALUES ($1,$2,$3)
       ON CONFLICT (scope) DO UPDATE SET theme = EXCLUDED.theme, updated_at = now()`,
      [newId(), scope, JSON.stringify(patch) as unknown as Json],
      { name: 'appearance.upsert', primary: true },
    );
  }

  async remove(scope: string): Promise<void> {
    await this.db.execute_(
      `DELETE FROM appearance_settings WHERE scope = $1`,
      [scope],
      { name: 'appearance.remove', primary: true },
    );
  }

  async listAll(): Promise<{ scope: string; theme: ThemePatch; updatedAt: string }[]> {
    return this.db.query(
      `SELECT scope, theme, updated_at AS "updatedAt" FROM appearance_settings ORDER BY scope`,
      [],
      { name: 'appearance.listAll' },
    );
  }
}
