import { Injectable } from '@nestjs/common';

import { DEFAULT_THEME, resolveTheme, themeToCss, mergeTheme, validateTheme, type Theme, type ThemePatch } from '../../domain/theme';
import { AppearanceRepository } from '../../infrastructure/persistence/appearance.repository';

const PLATFORM_SCOPE = '';

/**
 * Global Settings → Appearance — PLATFORM-WIDE (see migration 0018). Resolves
 * the effective design theme for a role (default ← role) and lets a super
 * admin edit the platform default and per-role overrides. Writes are
 * validated against the token schema before persisting, so a saved theme can
 * never brick the UI. The frontend hydrates its CSS variables from
 * `effectiveTheme`/`css` at boot, so a change here re-skins EVERY console —
 * the platform console and every operator's own console alike.
 */
@Injectable()
export class AppearanceService {
  constructor(private readonly repo: AppearanceRepository) {}

  /** The effective, fully-resolved theme for a role (or the platform default). */
  async effectiveTheme(role?: string): Promise<Theme> {
    const platformPatch = (await this.repo.getPatch(PLATFORM_SCOPE)) ?? {};
    const rolePatch = role ? ((await this.repo.getPatch(role)) ?? {}) : {};
    return resolveTheme(platformPatch, rolePatch);
  }

  async css(role?: string): Promise<string> {
    return themeToCss(await this.effectiveTheme(role));
  }

  /**
   * Save a partial override for a scope ('' = platform default, else a role code).
   * The patch is merged onto the CURRENT effective theme and validated so a bad
   * value is rejected before it can reach any user.
   */
  async savePatch(scope: string, patch: ThemePatch): Promise<Theme> {
    const base = scope === PLATFORM_SCOPE ? DEFAULT_THEME : await this.effectiveTheme();
    validateTheme(mergeTheme(base, patch)); // throws on an invalid override
    await this.repo.upsert(scope, patch);
    return this.effectiveTheme(scope === PLATFORM_SCOPE ? undefined : scope);
  }

  async reset(scope: string): Promise<void> {
    await this.repo.remove(scope);
  }

  /** All stored overrides + the baseline default (for the admin editor). */
  async overview(): Promise<{ default: Theme; overrides: { scope: string; theme: ThemePatch; updatedAt: string }[] }> {
    return { default: DEFAULT_THEME, overrides: await this.repo.listAll() };
  }
}
