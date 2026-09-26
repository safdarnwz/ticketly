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
  /** The route's own policy, else the operator-wide one, else flat fares. */
  ladder: YieldLadder;
  /** Services of this route with a policy of their own (it wins over `ladder`). */
  serviceLadders: Record<string, YieldLadder>;
  gstRatePct: number;
}

/** The yield ladder for one trip: its service's own policy first. */
export function ladderFor(
  pricing: RoutePricing,
  serviceId: string | null | undefined,
): YieldLadder {
  return (serviceId && pricing.serviceLadders[serviceId]) || pricing.ladder;
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
        // A price of zero (or less) is never a fare — it would sell free seats.
        if (exact && Number(exact.base_fare_minor) > 0)
          return {
            baseFareMinor: Number(exact.base_fare_minor),
            currency: plan.currency,
            seatType: input.seatType,
            farePlanId: plan.id,
          };

        // 2. whole-route rule (from/to NULL) for the seat type: its per-km
        //    rate times this segment's distance, never below its base fare.
        const perKm = await this.db.queryOne<{
          per_km_minor: number | null;
          base_fare_minor: number;
          segment_m: number | null;
        }>(
          `SELECT fr.per_km_minor, fr.base_fare_minor,
                  (SELECT t.distance_from_origin_m FROM route_stops t WHERE t.route_id = $4 AND t.stop_id = $6)
                  - (SELECT f.distance_from_origin_m FROM route_stops f WHERE f.route_id = $4 AND f.stop_id = $5) AS segment_m
             FROM fare_rules fr
            WHERE fr.tenant_id = $1 AND fr.fare_plan_id = $2 AND fr.from_stop_id IS NULL AND fr.to_stop_id IS NULL
              AND fr.seat_type = $3`,
          [
            requireTenantId(),
            plan.id,
            input.seatType,
            input.routeId,
            input.fromStopId,
            input.toStopId,
          ],
          { name: 'fare.perKm' },
        );
        if (perKm) {
          const km = Math.max(0, Number(perKm.segment_m ?? input.distanceM)) / 1000;
          const base = Number(perKm.base_fare_minor);
          const fare = perKm.per_km_minor ? Math.round(Number(perKm.per_km_minor) * km) : base;
          const minor = Math.max(fare, base);
          if (minor > 0)
            return {
              baseFareMinor: minor,
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
    await this.requireRoute(routeId);
    await this.db.execute_(
      `INSERT INTO route_pricing_rules (tenant_id, route_id, floor_minor, ceiling_minor, peak_windows, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id, route_id) DO UPDATE SET floor_minor = EXCLUDED.floor_minor, ceiling_minor = EXCLUDED.ceiling_minor,
         peak_windows = EXCLUDED.peak_windows, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [requireTenantId(), routeId, i.floorMinor, i.ceilingMinor, JSON.stringify(i.peakWindows), by],
      { name: 'fare.saveRouteRules', primary: true },
    );
    await this.pricesChanged(CacheNamespace.PRICING_POLICY);
  }

  /** What the route rules and one trip's manual change are now (for the editors). */
  async routeRules(routeId: string) {
    await this.requireRoute(routeId);
    const r = await this.db.queryOne<{
      floor_minor: string | null;
      ceiling_minor: string | null;
      peak_windows: PeakWindow[];
    }>(
      `SELECT floor_minor, ceiling_minor, peak_windows FROM route_pricing_rules WHERE tenant_id = $1 AND route_id = $2`,
      [requireTenantId(), routeId],
      { name: 'fare.getRouteRules', primary: true },
    );
    return {
      floorMinor: r?.floor_minor != null ? Number(r.floor_minor) : null,
      ceilingMinor: r?.ceiling_minor != null ? Number(r.ceiling_minor) : null,
      peakWindows: Array.isArray(r?.peak_windows) ? r.peak_windows : [],
    };
  }

  async tripAdjustment(tripId: string) {
    await this.requireTrip(tripId, false);
    const t = await this.db.queryOne<{ pct: string; reason: string | null; updated_at: string }>(
      `SELECT pct, reason, updated_at FROM trip_fare_adjustments WHERE tenant_id = $1 AND trip_id = $2`,
      [requireTenantId(), tripId],
      { name: 'fare.getTripAdjustment', primary: true },
    );
    return t
      ? { pct: Number(t.pct), reason: t.reason, updatedAt: t.updated_at }
      : { pct: null, reason: null, updatedAt: null };
  }

  /** This operator's trip; for a change, one still on sale ahead (a fare change after departure means nothing). */
  private async requireTrip(tripId: string, forChange: boolean): Promise<void> {
    const t = await this.db.queryOne<{ upcoming: boolean }>(
      `SELECT (status IN ('scheduled', 'open', 'closed') AND departs_at > now()) AS upcoming
         FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId],
      { name: 'fare.requireTrip', primary: true },
    );
    if (!t) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Trip not found' });
    if (forChange && !t.upcoming)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'This trip has left or was cancelled — its fare cannot change',
      });
  }

  async setTripAdjustment(
    tripId: string,
    pct: number | null,
    reason: string | null,
    by: string | null,
  ): Promise<void> {
    await this.requireTrip(tripId, true);
    if (pct === null) {
      await this.db.execute_(
        `DELETE FROM trip_fare_adjustments WHERE tenant_id = $1 AND trip_id = $2`,
        [requireTenantId(), tripId],
        { name: 'fare.clearTripAdj', primary: true },
      );
      await this.pricesChanged(CacheNamespace.PRICING_POLICY);
      return;
    }
    await this.db.execute_(
      `INSERT INTO trip_fare_adjustments (tenant_id, trip_id, pct, reason, created_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, trip_id) DO UPDATE SET pct = EXCLUDED.pct, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, updated_at = now()`,
      [requireTenantId(), tripId, pct, reason, by],
      { name: 'fare.setTripAdj', primary: true },
    );
    await this.pricesChanged(CacheNamespace.PRICING_POLICY);
  }

  async routePricing(routeId: RouteId): Promise<RoutePricing> {
    const [row, gstRatePct] = await Promise.all([
      this.cache.getOrLoad<{ ladder: YieldLadder | null; services: Record<string, YieldLadder> }>(
        `policy:${routeId}`,
        { namespace: CacheNamespace.PRICING_POLICY, ttlSeconds: CacheTtl.FARE_RULES },
        async () => {
          const [r, perService] = await Promise.all([
            this.db.queryOne<{ ladder: YieldLadder }>(
              `SELECT ladder FROM pricing_policies
                WHERE tenant_id = $1 AND is_active AND service_id IS NULL
                  AND (route_id = $2 OR route_id IS NULL)
                ORDER BY route_id NULLS LAST, created_at DESC LIMIT 1`,
              [requireTenantId(), routeId],
              { name: 'fare.routePricing' },
            ),
            this.db.query<{ service_id: string; ladder: YieldLadder }>(
              `SELECT p.service_id, p.ladder FROM pricing_policies p
                 JOIN services s ON s.id = p.service_id AND s.tenant_id = p.tenant_id
                WHERE p.tenant_id = $1 AND p.is_active AND s.route_id = $2`,
              [requireTenantId(), routeId],
              { name: 'fare.servicePricing' },
            ),
          ]);
          return {
            ladder: r?.ladder ?? null,
            services: Object.fromEntries(perService.map((x) => [x.service_id, x.ladder])),
          };
        },
      ),
      this.platformSettings.gstRatePercent(),
    ]);
    const ladder = row.ladder ?? {
      occupancy: [],
      advancePurchase: [],
      maxMultiplier: 1,
      minMultiplier: 1,
    };
    return { ladder, serviceLadders: row.services ?? {}, gstRatePct };
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
    await this.requireRoute(input.routeId);
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

  /** A plan with no fare yet cannot go live — its buses would have nothing to sell at. */
  async activatePlan(planId: string): Promise<void> {
    const plan = await this.db.queryOne<{ rules: number }>(
      `SELECT (SELECT count(*)::int FROM fare_rules r WHERE r.fare_plan_id = p.id) AS rules
         FROM fare_plans p WHERE p.tenant_id = $1 AND p.id = $2`,
      [requireTenantId(), planId],
      { name: 'fare.planRuleCount', primary: true },
    );
    if (!plan)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Fare plan not found' });
    if (plan.rules === 0) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Add a fare to this plan before activating it',
      });
    }
    await this.db.execute_(
      `UPDATE fare_plans SET status = 'active', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), planId],
      { name: 'fare.activatePlan', primary: true },
    );
    await this.pricesChanged(CacheNamespace.FARE_RULE);
  }

  /**
   * Ids from the request must be this operator's: a foreign key alone would
   * accept another operator's route or plan (it does not see row-level security).
   */
  private async requireRoute(routeId: string): Promise<void> {
    const found = await this.db.queryOne(
      `SELECT 1 FROM routes WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), routeId],
      { name: 'fare.requireRoute', primary: true },
    );
    if (!found) throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Route not found' });
  }

  private async requirePlan(planId: string): Promise<void> {
    const found = await this.db.queryOne(
      `SELECT 1 FROM fare_plans WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), planId],
      { name: 'fare.requirePlan', primary: true },
    );
    if (!found) {
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Fare plan not found' });
    }
  }

  /**
   * Drop cached fares — and the cached search results priced from them, so
   * "starts from" on the results page does not keep showing the old price.
   */
  private async pricesChanged(namespace: string): Promise<void> {
    await this.cache.invalidatePrefix(namespace);
    await this.cache.invalidatePrefix(CacheNamespace.SEARCH);
  }

  /**
   * One active policy per scope (a route, or operator-wide): a new one replaces
   * the earlier one, which stays listed as switched off. `gstRatePct` is NOT
   * accepted — GST is a government rate, set only via PlatformSettingsRepository
   * (super-admin), never per-policy. The column keeps its DB default; nothing
   * reads it anymore (see routePricing).
   */
  async createPolicy(input: {
    routeId?: string;
    serviceId?: string;
    name: string;
    ladder: unknown;
  }): Promise<string> {
    const tenantId = requireTenantId();
    if (input.serviceId) {
      const service = await this.db.queryOne(
        `SELECT 1 FROM services WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, input.serviceId],
        { name: 'fare.policyService' },
      );
      if (!service)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Service not found' });
    }
    if (input.routeId) {
      const route = await this.db.queryOne(
        `SELECT 1 FROM routes WHERE tenant_id = $1 AND id = $2`,
        [tenantId, input.routeId],
        { name: 'fare.policyRoute' },
      );
      if (!route)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Route not found' });
    }
    await this.db.execute_(
      `UPDATE pricing_policies SET is_active = false
        WHERE tenant_id = $1 AND is_active AND route_id IS NOT DISTINCT FROM $2::uuid
          AND service_id IS NOT DISTINCT FROM $3::uuid`,
      [tenantId, input.routeId ?? null, input.serviceId ?? null],
      { name: 'fare.replacePolicy', primary: true },
    );
    const id = newId();
    await this.db.execute_(
      `INSERT INTO pricing_policies (id, tenant_id, route_id, service_id, name, ladder)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        tenantId,
        input.routeId ?? null,
        input.serviceId ?? null,
        input.name,
        JSON.stringify(input.ladder),
      ],
      { name: 'fare.createPolicy', primary: true },
    );
    await this.pricesChanged(CacheNamespace.PRICING_POLICY);
    return id;
  }

  /** Stop a policy — its routes go back to the operator-wide one, or to plain fares. */
  async deactivatePolicy(id: string): Promise<void> {
    const affected = await this.db.execute_(
      `UPDATE pricing_policies SET is_active = false WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'fare.deactivatePolicy', primary: true },
    );
    if (affected === 0) {
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Policy not found' });
    }
    await this.pricesChanged(CacheNamespace.PRICING_POLICY);
  }

  async addRule(input: {
    farePlanId: string;
    fromStopId?: StopId;
    toStopId?: StopId;
    seatType: string;
    baseFareMinor: number;
    perKmMinor?: number;
  }): Promise<void> {
    await this.requirePlan(input.farePlanId);
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
    await this.pricesChanged(CacheNamespace.FARE_RULE);
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

  /** The plan's route, or null when it is not this operator's plan. */
  async planRoute(farePlanId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ route_id: string }>(
      `SELECT route_id FROM fare_plans WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), farePlanId],
      { name: 'fare.planRoute', primary: true },
    );
    return row?.route_id ?? null;
  }

  /** Stop ids (of the given ones) that are on the route. */
  async stopsOnRoute(routeId: string, stopIds: string[]): Promise<Set<string>> {
    const rows = await this.db.query<{ stop_id: string }>(
      `SELECT stop_id FROM route_stops WHERE route_id = $1 AND stop_id = ANY($2::uuid[])`,
      [routeId, stopIds],
      { name: 'fare.stopsOnRoute', primary: true },
    );
    return new Set(rows.map((r) => r.stop_id));
  }

  /**
   * Raise or lower every rule of a plan by `percent` (#267), rounded to
   * `roundToMinor` (e.g. 100 = whole rupees). Returns rules changed.
   */
  async adjustRules(
    farePlanId: string,
    percent: number,
    seatType: string | null,
    roundToMinor: number,
  ): Promise<number> {
    const n = await this.db.execute_(
      `UPDATE fare_rules SET
         base_fare_minor = greatest(0, round(base_fare_minor * (1 + $3::numeric / 100) / $5) * $5),
         per_km_minor = CASE WHEN per_km_minor IS NULL THEN NULL
                             ELSE greatest(0, round(per_km_minor * (1 + $3::numeric / 100))) END
       WHERE tenant_id = $1 AND fare_plan_id = $2 AND ($4::text IS NULL OR seat_type = $4)`,
      [requireTenantId(), farePlanId, percent, seatType, roundToMinor],
      { name: 'fare.adjustRules', primary: true },
    );
    await this.pricesChanged(CacheNamespace.FARE_RULE);
    return n;
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
    {
      id: string;
      routeId: string | null;
      serviceId: string | null;
      name: string;
      ladder: YieldLadder;
      isActive: boolean;
      createdAt: Date;
    }[]
  > {
    return this.db.query(
      `SELECT id, route_id AS "routeId", service_id AS "serviceId", name, ladder,
              is_active AS "isActive", created_at AS "createdAt"
         FROM pricing_policies
        WHERE tenant_id = $1 ORDER BY is_active DESC, created_at DESC`,
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
    await this.requirePlan(farePlanId);
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
    const affected = await this.db.execute_(
      `DELETE FROM seat_fare_overrides WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'fare.deleteSeatOverride', primary: true },
    );
    if (affected === 0) {
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Seat price not found' });
    }
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
