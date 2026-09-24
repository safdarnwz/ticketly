import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AppError, ErrorCode, getContext } from '@kernel';

import { PlatformSettingsRepository } from '../../../tenancy/infrastructure/persistence/platform-settings.repository';

export interface MaintenanceState {
  enabled: boolean;
  message?: string;
  until?: string | null;
}
export const MAINTENANCE_KEY = 'maintenance_mode';

/**
 * Platform maintenance mode. While ON:
 *  - reads (GET/HEAD/OPTIONS) keep working — customers can still look up tickets;
 *  - writes get 503 + Retry-After, so clients/OTAs retry instead of failing hard;
 *  - payment webhooks and PSP callbacks are EXEMPT — money already in flight
 *    must still confirm bookings, or captured customers get no ticket;
 *  - platform admins (authenticated, no tenant) keep full access to fix things.
 * The flag is read at most every 10 s per process (no DB hit per request).
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  private cached: { state: MaintenanceState; at: number } | null = null;

  constructor(private readonly settings: PlatformSettingsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const url = req.url ?? '';
    if (
      /\/payments\/(webhook|callback|verify)/.test(url) ||
      /\/admin\/platform\/maintenance/.test(url) ||
      /\/auth\//.test(url)
    )
      return true;

    const state = await this.state();
    if (!state.enabled) return true;
    const ctx = getContext();
    if (ctx?.userId && !ctx.tenantId) return true; // platform admin

    const until = state.until ? Date.parse(state.until) : NaN;
    const retryAfter = Number.isFinite(until)
      ? Math.max(60, Math.round((until - Date.now()) / 1000))
      : 300;
    throw new AppError(ErrorCode.COMMON_INTERNAL, 503, {
      message:
        state.message?.trim() ||
        'Ticketly is under scheduled maintenance. Bookings resume shortly — please try again in a few minutes.',
      retryable: true,
      retryAfterSeconds: retryAfter,
      details: { maintenance: true, until: state.until ?? null },
    });
  }

  /** Drop the cached state immediately (called when an admin toggles it on this instance). */
  invalidate(): void {
    this.cached = null;
  }

  private async state(): Promise<MaintenanceState> {
    if (this.cached && Date.now() - this.cached.at < 10_000) return this.cached.state;
    const state = await this.settings
      .get<MaintenanceState>(MAINTENANCE_KEY, { enabled: false })
      .catch(() => ({ enabled: false }));
    this.cached = { state, at: Date.now() };
    return state;
  }
}
