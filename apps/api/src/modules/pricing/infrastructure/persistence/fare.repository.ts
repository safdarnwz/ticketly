import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService } from '@database';
import { newId, requireTenantId, type RouteId, type StopId } from '@kernel';
import { AppError, ErrorCode } from '@kernel';

import { PlatformSettingsRepository } from '../../../platform-settings';
import type { YieldLadder } from '../../domain/pricing-engine';
import {
  selectFarePlan,
  validatePlanWindow,
  type FarePlanCandidate,
} from '../../domain/fare-plan-selection';
import type { PeakWindow } from '../../domain/pricing-rules';

export interface ResolvedFare {
  baseFareMinor: number;
  currency: string;
  seatType: string;
  farePlanId: string;
}

export interface RoutePricing {
  ladder: YieldLadder;
  gstRatePct: number;
}

/**
 * Fare & pricing-policy lookups.
 *
 * Fares change rarely and are read on every search, so both the resolved
 * segment fare and the route's pricing policy are cache-backed with a long TTL
 * and invalidated on write. The fare resolution tries the exact
 * (from,to,seat_type) rule first, then a distance-proportional fallback, then
 * an any-segment fallback — so an operator can define a full fare matrix or just
 * a per-km rate.
 */
@Injectable()
export class FareRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly platformSettings: PlatformSettingsRepository,
  ) {}

  /**
   * Resolve the base fare for a segment on the plan that applies on the
   * JOURNEY DATE (regular / weekend / seasonal / special-day — see
   * fare-plan-selection.ts). Two cache levels: the route's active plans
   * (small, rarely changes) and the rule per plan+segment+seat type — the
   * plan id is in the key, so fares of different seasons never mix.
   */
  async resolveFare(input: {
    routeId: RouteId;
    fromStopId: StopId;
    toStopId: StopId;
    seatType: string;
    distanceM: number;
    /** YYYY-MM-DD at the origin — decides which tariff applies. */
    journeyDate: string;
  }): Promise<ResolvedFare | null> {
    const plans = await this.activePlans(input.routeId);
    const chosen = selectFarePlan(plans, input.journeyDate);
    if (!chosen) return null;
    const plan = plans.find((p) => p.id === chosen.id)!;
    const key = `${plan.id}:${input.fromStopId}:${input.toStopId}:${input.seatType}`;
    return this.cache.getOrLoad<ResolvedFare | null>(
      key,
      { namespace: CacheNamespace.FARE_RULE, ttlSeconds: CacheTtl.FARE_RULES },
      async () => {
        // 1. exact segment rule
        const exact = await this.db.queryOne<{
          base_fare_minor: number;
          per_km_minor: number | null;
        }>(
          `SELECT base_fare_minor, per_km_minor FROM fare_rules
            WHERE tenant_id = $1 AND fare_plan_id = $2 AND from_stop_id = $3 AND to_stop_id = $4 AND seat_type = $5`,
          [requireTenantId(), plan.id, input.fromStopId, input.toStopId, input.seatType],
          { name: 'fare.exact' },
        );
        if (exact)
          return {
            baseFareMinor: exact.base_fare_minor,
            currency: plan.currency,
            seatType: input.seatType,
            farePlanId: plan.id,
          };

        // 2. per-km fallback rule (from/to NULL) for the seat type
        const perKm = await this.db.queryOne<{
          per_km_minor: number | null;
          base_fare_minor: number;
        }>(
          `SELECT per_km_minor, base_fare_minor FROM fare_rules
            WHERE tenant_id = $1 AND fare_plan_id = $2 AND from_stop_id IS NULL AND to_stop_id IS NULL AND seat_type = $3`,
          [requireTenantId(), plan.id, input.seatType],
          { name: 'fare.perKm' },
        );
        if (perKm) {
          const km = input.distanceM / 1000;
          const fare = perKm.per_km_minor
            ? Math.round(perKm.per_km_minor * km)
            : perKm.base_fare_minor;
          return {
            baseFareMinor: Math.max(fare, perKm.base_fare_minor),
            currency: plan.currency,
            seatType: input.seatType,
            farePlanId: plan.id,
          };
        }

        return null;
      },
    );
  }

  /**
   * The dynamic-pricing ladder (route-specific or tenant default) + the
   * GST rate. GST is ALWAYS the government-mandated platform rate — never
   * `pricing_policies.gst_rate_pct` (legacy column, deliberately unread now;
   * see migration 0021's comment for why an operator-settable tax rate is a
   * compliance bug, not a business feature).
   */
  /** Route floor/ceiling + peak windows, and the trip's manual adjustment (both optional). */
  async pricingControls(
    routeId: RouteId,
    tripId: string,
  ): Promise<{
    floorMinor: number | null;
    ceilingMinor: number | null;
    peakWindows: PeakWindow[];
    tripPct: number | null;
  }> {
    const [r, t] = await Promise.all([
      this.db.queryOne<{
        floor_minor: string | null;
        ceiling_minor: string | null;
        peak_windows: PeakWindow[];
      }>(
        `SELECT floor_minor, ceiling_minor, peak_windows FROM route_pricing_rules WHERE tenant_id = $1 AND route_id = $2`,
        [requireTenantId(), routeId],
        { name: 'fare.routeRules' },
      ),
      this.db.queryOne<{ pct: string }>(
        `SELECT pct FROM trip_fare_adjustments WHERE tenant_id = $1 AND trip_id = $2`,
        [requireTenantId(), tripId],
        { name: 'fare.tripAdjustment' },
      ),
    ]);
    return {
      floorMinor: r?.floor_minor != null ? Number(r.floor_minor) : null,
      ceilingMinor: r?.ceiling_minor != null ? Number(r.ceiling_minor) : null,
      peakWindows: Array.isArray(r?.peak_windows) ? r.peak_windows : [],
      tripPct: t ? Number(t.pct) : null,
    };
  }

  async saveRouteRules(
    routeId: string,
    i: { floorMinor: number | null; ceilingMinor: number | null; peakWindows: PeakWindow[] },
    by: string | null,
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO route_pricing_rules (tenant_id, route_id, floor_minor, ceiling_minor, peak_windows, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, route_id) DO UPDATE SET floor_minor = EXCLUDED.floor_minor, ceiling_minor = EXCLUDED.ceiling_minor,
         peak_windows = EXCLUDED.peak_windows, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [requireTenantId(), routeId, i.floorMinor, i.ceilingMinor, JSON.stringify(i.peakWindows), by],
      { name: 'fare.saveRouteRules', primary: true },
    );
  }

  async setTripAdjustment(
    tripId: string,
    pct: number | null,
    reason: string | null,
    by: string | null,
  ): Promise<void> {
    if (pct === null) {
      await this.db.execute_(
        `DELETE FROM trip_fare_adjustments WHERE tenant_id = $1 AND trip_id = $2`,
        [requireTenantId(), tripId],
        { name: 'fare.clearTripAdj', primary: true },
      );
      return;
    }
    await this.db.execute_(
      `INSERT INTO trip_fare_adjustments (tenant_id, trip_id, pct, reason, created_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, trip_id) DO UPDATE SET pct = EXCLUDED.pct, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, updated_at = now()`,
      [requireTenantId(), tripId, pct, reason, by],
      { name: 'fare.setTripAdj', primary: true },
    );
  }

  async routePricing(routeId: RouteId): Promise<RoutePricing> {
    const [row, gstRatePct] = await Promise.all([
      this.cache.getOrLoad<{ ladder: YieldLadder } | null>(
        `policy:${routeId}`,
        { namespace: CacheNamespace.PRICING_POLICY, ttlSeconds: CacheTtl.FARE_RULES },
        async () => {
          const r = await this.db.queryOne<{ ladder: YieldLadder }>(
            `SELECT ladder FROM pricing_policies
              WHERE tenant_id = $1 AND is_active AND (route_id = $2 OR route_id IS NULL)
              ORDER BY route_id NULLS LAST LIMIT 1`,
            [requireTenantId(), routeId],
            { name: 'fare.routePricing' },
          );
          return r;
        },
      ),
      this.platformSettings.gstRatePercent(),
    ]);
    const ladder = row?.ladder ?? {
      occupancy: [],
      advancePurchase: [],
      maxMultiplier: 1,
      minMultiplier: 1,
    };
    return { ladder, gstRatePct };
  }

  /** The route's active plans with their date window + weekday filter (cached; tiny). */
  private async activePlans(
    routeId: RouteId,
  ): Promise<(FarePlanCandidate & { currency: string })[]> {
    return this.cache.getOrLoad(
      `plans:${routeId}`,
      { namespace: CacheNamespace.FARE_RULE, ttlSeconds: CacheTtl.FARE_RULES },
      async () =>
        (
          await this.db.query<{
            id: string;
            currency: string;
            effective_from: string | null;
            effective_to: string | null;
            weekdays: number[] | null;
          }>(
            `SELECT id, currency, effective_from::text AS effective_from, effective_to::text AS effective_to, weekdays
           FROM fare_plans WHERE tenant_id = $1 AND route_id = $2 AND status = 'active' AND deleted_at IS NULL`,
            [requireTenantId(), routeId],
            { name: 'fare.activePlans' },
          )
        ).map((r) => ({
          id: r.id,
          currency: r.currency,
          effectiveFrom: r.effective_from,
          effectiveTo: r.effective_to,
          weekdays: r.weekdays?.map(Number) ?? null,
        })),
    );
  }

  async createPlan(input: {
    routeId: RouteId;
    name: string;
    currency?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    weekdays?: number[];
  }): Promise<string> {
    const problem = validatePlanWindow(input);
    if (problem) throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: problem });
    const id = newId();
    await this.db.execute_(
      `INSERT INTO fare_plans (id, tenant_id, route_id, name, currency, effective_from, effective_to, weekdays)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        requireTenantId(),
        input.routeId,
        input.name,
        input.currency ?? 'INR',
        input.effectiveFrom ?? null,
        input.effectiveTo ?? null,
        input.weekdays?.length ? [...new Set(input.weekdays)].sort() : null,
      ],
      { name: 'fare.createPlan', primary: true },
    );
    return id;
  }

  async activatePlan(planId: string): Promise<void> {
    await this.db.execute_(
      `UPDATE fare_plans SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), planId],
      { name: 'fare.activatePlan', primary: true },
    );
  }

  /** `gstRatePct` is NOT accepted here — GST is a government rate, set only via PlatformSettingsRepository (super-admin), never per-policy. The column keeps its DB default; nothing reads it anymore (see routePricing). */
  async createPolicy(input: { routeId?: string; name: string; ladder: unknown }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO pricing_policies (id, tenant_id, route_id, name, ladder)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, requireTenantId(), input.routeId ?? null, input.name, JSON.stringify(input.ladder)],
      { name: 'fare.createPolicy', primary: true },
    );
    await this.cache.invalidatePrefix(CacheNamespace.PRICING_POLICY);
    return id;
  }

  async addRule(input: {
    farePlanId: string;
    fromStopId?: StopId;
    toStopId?: StopId;
    seatType: string;
    baseFareMinor: number;
    perKmMinor?: number;
  }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO fare_rules (id, tenant_id, fare_plan_id, from_stop_id, to_stop_id, seat_type, base_fare_minor, per_km_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (fare_plan_id, from_stop_id, to_stop_id, seat_type)
       DO UPDATE SET base_fare_minor = EXCLUDED.base_fare_minor, per_km_minor = EXCLUDED.per_km_minor`,
      [
        newId(),
        requireTenantId(),
        input.farePlanId,
        input.fromStopId ?? null,
        input.toStopId ?? null,
        input.seatType,
        input.baseFareMinor,
        input.perKmMinor ?? null,
      ],
      { name: 'fare.addRule', primary: true },
    );
    await this.cache.invalidatePrefix(CacheNamespace.FARE_RULE);
  }

  async listPlans(): Promise<
    { id: string; routeId: string; name: string; currency: string; status: string }[]
  > {
    return this.db.query(
      `SELECT id, route_id AS "routeId", name, currency, status FROM fare_plans
        WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [requireTenantId()],
      { name: 'fare.listPlans' },
    );
  }

  async listRules(farePlanId: string): Promise<
    {
      id: string;
      fromStopId: string | null;
      toStopId: string | null;
      seatType: string;
      baseFareMinor: number;
      perKmMinor: number | null;
    }[]
  > {
    return this.db.query(
      `SELECT id, from_stop_id AS "fromStopId", to_stop_id AS "toStopId", seat_type AS "seatType",
              base_fare_minor AS "baseFareMinor", per_km_minor AS "perKmMinor"
         FROM fare_rules WHERE tenant_id = $1 AND fare_plan_id = $2 ORDER BY seat_type`,
      [requireTenantId(), farePlanId],
      { name: 'fare.listRules' },
    );
  }

  async listPolicies(): Promise<
    { id: string; routeId: string | null; name: string; gstRatePct: number }[]
  > {
    return this.db.query(
      `SELECT id, route_id AS "routeId", name, gst_rate_pct AS "gstRatePct" FROM pricing_policies
        WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [requireTenantId()],
      { name: 'fare.listPolicies' },
    );
  }

  /* ── per-seat-number fare overrides ──────────────────────────────────────
   * A flat amount for a SPECIFIC seat number on a fare plan, regardless of
   * segment — checked BEFORE the seat-type rule (see PricingService.quote,
   * which calls this per seat number being priced). Not cached like
   * resolveFare — this list is small per plan and changes rarely, and NOT
   * being stale here matters more than shaving a query.
   */

  async setSeatOverride(farePlanId: string, seatNumber: string, fareMinor: number): Promise<void> {
    await this.db.execute_(
      `INSERT INTO seat_fare_overrides (id, tenant_id, fare_plan_id, seat_number, fare_minor)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (fare_plan_id, seat_number) DO UPDATE SET fare_minor = EXCLUDED.fare_minor, updated_at = now()`,
      [newId(), requireTenantId(), farePlanId, seatNumber.trim(), fareMinor],
      { name: 'fare.setSeatOverride', primary: true },
    );
  }

  async listSeatOverrides(
    farePlanId: string,
  ): Promise<{ id: string; seatNumber: string; fareMinor: number }[]> {
    return this.db.query(
      `SELECT id, seat_number AS "seatNumber", fare_minor AS "fareMinor" FROM seat_fare_overrides
        WHERE tenant_id = $1 AND fare_plan_id = $2 ORDER BY seat_number`,
      [requireTenantId(), farePlanId],
      { name: 'fare.listSeatOverrides' },
    );
  }

  async deleteSeatOverride(id: string): Promise<void> {
    await this.db.execute_(
      `DELETE FROM seat_fare_overrides WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'fare.deleteSeatOverride', primary: true },
    );
  }

  /** Batch lookup for a specific set of seat numbers — what PricingService.quote actually uses when pricing a real seat selection. */
  async seatOverridesFor(farePlanId: string, seatNumbers: string[]): Promise<Map<string, number>> {
    if (seatNumbers.length === 0) return new Map();
    const rows = await this.db.query<{ seat_number: string; fare_minor: number }>(
      `SELECT seat_number, fare_minor FROM seat_fare_overrides WHERE tenant_id = $1 AND fare_plan_id = $2 AND seat_number = ANY($3)`,
      [requireTenantId(), farePlanId, seatNumbers],
      { name: 'fare.seatOverridesFor' },
    );
    return new Map(rows.map((r) => [r.seat_number, Number(r.fare_minor)]));
  }
}
