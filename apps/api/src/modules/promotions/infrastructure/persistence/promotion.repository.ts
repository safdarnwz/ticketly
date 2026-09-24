import { Injectable } from '@nestjs/common';

import { DatabaseService, UnitOfWork } from '@database';
import { newId, requireTenantId, type RouteId, type TenantId } from '@kernel';

import type { PromotionBillingCycle } from '../../domain/promotion-pricing';

export interface PromotionPricingRule {
  id: string;
  billingCycle: PromotionBillingCycle;
  isMultiRoute: boolean;
  priceMinor: number;
  currency: string;
}

export interface RoutePromotion {
  id: string;
  tenantId: TenantId;
  routeId: RouteId;
  groupId: string;
  billingCycle: PromotionBillingCycle | null;
  priceMinor: number;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  status: 'pending_payment' | 'active' | 'paused' | 'expired' | 'cancelled';
  autoRenew: boolean;
  createdAt: Date;
  version: number;
  /** The platform charge that bills it, once active. */
  platformChargeId: string | null;
}

@Injectable()
export class PromotionRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly uow: UnitOfWork,
  ) {}

  /** The CURRENTLY-effective rate card — super-admin's pricing.module, not tenant-scoped (one rate card for the whole platform). */
  async currentRates(): Promise<PromotionPricingRule[]> {
    const rows = await this.db.query<{
      id: string;
      billing_cycle: PromotionBillingCycle;
      is_multi_route: boolean;
      price_minor: string;
      currency: string;
    }>(
      `SELECT id, billing_cycle, is_multi_route, price_minor, currency FROM promotion_pricing_rules WHERE effective_to IS NULL ORDER BY billing_cycle, is_multi_route`,
      [],
      { name: 'promotion.currentRates' },
    );
    return rows.map((r) => ({
      id: r.id,
      billingCycle: r.billing_cycle,
      isMultiRoute: r.is_multi_route,
      priceMinor: Number(r.price_minor),
      currency: r.currency,
    }));
  }

  async rateFor(
    billingCycle: PromotionBillingCycle,
    isMultiRoute: boolean,
  ): Promise<PromotionPricingRule | null> {
    const row = await this.db.queryOne<{ id: string; price_minor: string; currency: string }>(
      `SELECT id, price_minor, currency FROM promotion_pricing_rules WHERE billing_cycle = $1 AND is_multi_route = $2 AND effective_to IS NULL`,
      [billingCycle, isMultiRoute],
      { name: 'promotion.rateFor' },
    );
    return row
      ? {
          id: row.id,
          billingCycle,
          isMultiRoute,
          priceMinor: Number(row.price_minor),
          currency: row.currency,
        }
      : null;
  }

  /**
   * Supersedes (never deletes) the current rate for this (cycle, bundle)
   * pair — closing the old row's effective_to and inserting a new one, so
   * every historical price a promotion was actually purchased at remains
   * explainable later (a billing dispute, an old invoice line item).
   */
  async setRate(
    billingCycle: PromotionBillingCycle,
    isMultiRoute: boolean,
    priceMinor: number,
    actorUserId: string | null,
  ): Promise<void> {
    await this.uow.run({ name: 'promotion.setRate' }, async (scope) => {
      await scope.client.query(
        `UPDATE promotion_pricing_rules SET effective_to = now() WHERE billing_cycle = $1 AND is_multi_route = $2 AND effective_to IS NULL`,
        [billingCycle, isMultiRoute],
      );
      await scope.client.query(
        `INSERT INTO promotion_pricing_rules (id, billing_cycle, is_multi_route, price_minor, created_by) VALUES ($1,$2,$3,$4,$5)`,
        [newId(), billingCycle, isMultiRoute, priceMinor, actorUserId],
      );
    });
  }

  /**
   * Every ACTIVE promotion, platform-wide, whose window covers `now` — the
   * hot-path SearchService reads per search. bypassRls is required: this
   * is read from BOTH a single-tenant search context AND the cross-tenant
   * "search all operators" storefront context, and route_promotions has
   * tenant-scoped RLS — without bypassing, a cross-tenant search (no
   * tenant bound) would see zero promotions from EVERY operator, silently
   * making the whole feature inert exactly on the storefront surface
   * where most searches actually happen. Cached upstream; this is the
   * cache-miss path.
   */
  async activePromotionsForRoutes(
    routeIds: readonly string[],
    now: Date,
  ): Promise<RoutePromotion[]> {
    if (routeIds.length === 0) return [];
    const result = await this.uow.run(
      { name: 'promotion.activeForRoutes', bypassRls: true },
      async (scope) =>
        scope.client.query<Row>(
          `SELECT id, tenant_id, route_id, group_id, billing_cycle, price_minor, currency, starts_at, ends_at, status, auto_renew, created_at, version, platform_charge_id
           FROM route_promotions
          WHERE route_id = ANY($1::uuid[]) AND status = 'active' AND starts_at <= $2 AND ends_at > $2`,
          [routeIds, now],
        ),
    );
    return result.rows.map(map);
  }

  async create(input: {
    routeId: RouteId;
    groupId: string;
    billingCycle?: PromotionBillingCycle | null;
    priceMinor: number;
    currency: string;
    startsAt: Date;
    endsAt: Date;
    autoRenew: boolean;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO route_promotions (id, tenant_id, route_id, group_id, billing_cycle, price_minor, currency, starts_at, ends_at, auto_renew, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending_payment')`,
      [
        id,
        requireTenantId(),
        input.routeId,
        input.groupId,
        input.billingCycle ?? null,
        input.priceMinor,
        input.currency,
        input.startsAt,
        input.endsAt,
        input.autoRenew,
      ],
      { name: 'promotion.create', primary: true },
    );
    return id;
  }

  /** Is the route already promoted (active or awaiting payment) during any part of the window? */
  async hasOverlap(routeId: RouteId, startsAt: Date, endsAt: Date): Promise<boolean> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM route_promotions
        WHERE tenant_id = $1 AND route_id = $2 AND status IN ('pending_payment','active')
          AND starts_at < $4 AND ends_at > $3
        LIMIT 1`,
      [requireTenantId(), routeId, startsAt, endsAt],
      { name: 'promotion.hasOverlap', primary: true },
    );
    return !!row;
  }

  async listForTenant(status?: string): Promise<RoutePromotion[]> {
    const params: unknown[] = [requireTenantId()];
    let where = 'tenant_id = $1';
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    const rows = await this.db.query<Row>(
      `SELECT id, tenant_id, route_id, group_id, billing_cycle, price_minor, currency, starts_at, ends_at, status, auto_renew, created_at, version, platform_charge_id
         FROM route_promotions WHERE ${where} ORDER BY created_at DESC`,
      params,
      { name: 'promotion.listForTenant' },
    );
    return rows.map(map);
  }

  async findForUpdate(id: string): Promise<RoutePromotion | null> {
    const row = await this.db.queryOne<Row>(
      `SELECT id, tenant_id, route_id, group_id, billing_cycle, price_minor, currency, starts_at, ends_at, status, auto_renew, created_at, version, platform_charge_id
         FROM route_promotions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), id],
      { name: 'promotion.findForUpdate', primary: true },
    );
    return row ? map(row) : null;
  }

  async activate(id: string, platformChargeId: string, expectedVersion: number): Promise<boolean> {
    const affected = await this.db.execute_(
      `UPDATE route_promotions SET status = 'active', platform_charge_id = $3, version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $4 AND status = 'pending_payment'`,
      [requireTenantId(), id, platformChargeId, expectedVersion],
      { name: 'promotion.activate', primary: true },
    );
    return affected > 0;
  }

  async cancel(id: string, expectedVersion: number): Promise<boolean> {
    const affected = await this.db.execute_(
      `UPDATE route_promotions SET status = 'cancelled', cancelled_at = now(), version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status IN ('pending_payment','active')`,
      [requireTenantId(), id, expectedVersion],
      { name: 'promotion.cancel', primary: true },
    );
    return affected > 0;
  }

  /**
   * Opt-out without giving up paid-for days — see migration 0047's
   * comment for the full pause/resume vs cancel reasoning. Only an
   * ACTIVE promotion can be paused (a pending_payment one was never
   * showing in the first place; a paused/expired/cancelled one is
   * already not showing).
   */
  async pause(id: string, expectedVersion: number): Promise<boolean> {
    const affected = await this.db.execute_(
      `UPDATE route_promotions SET status = 'paused', paused_at = now(), version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status = 'active'`,
      [requireTenantId(), id, expectedVersion],
      { name: 'promotion.pause', primary: true },
    );
    return affected > 0;
  }

  /**
   * Opt back in — extends ends_at by exactly the paused duration (now -
   * paused_at) so the full originally-paid-for day-count is always
   * eventually shown, however many pause/resume cycles happen along the
   * way. Returns the row so the caller can report the new ends_at back
   * to the operator without a second read.
   */
  async resume(id: string, expectedVersion: number): Promise<RoutePromotion | null> {
    const row = await this.db.queryOne<Row>(
      `UPDATE route_promotions
          SET status = 'active',
              ends_at = ends_at + (now() - paused_at),
              paused_at = NULL,
              version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $3 AND status = 'paused'
        RETURNING id, tenant_id, route_id, group_id, billing_cycle, price_minor, currency, starts_at, ends_at, status, auto_renew, created_at, version, platform_charge_id`,
      [requireTenantId(), id, expectedVersion],
      { name: 'promotion.resume', primary: true },
    );
    return row ? map(row) : null;
  }

  /** Called by the daily sweep — flips anything whose window has genuinely ended. Cross-tenant by design (a scheduler sweep, not a request in any one tenant's context). */
  async expireEnded(now: Date): Promise<number> {
    return this.db.execute_(
      `UPDATE route_promotions SET status = 'expired', version = version + 1 WHERE status = 'active' AND ends_at <= $1`,
      [now],
      { name: 'promotion.expireEnded', primary: true },
    );
  }
}

interface Row {
  id: string;
  tenant_id: TenantId;
  route_id: RouteId;
  group_id: string;
  billing_cycle: PromotionBillingCycle | null;
  price_minor: string;
  currency: string;
  starts_at: Date;
  ends_at: Date;
  status: RoutePromotion['status'];
  auto_renew: boolean;
  created_at: Date;
  version: number;
  platform_charge_id: string | null;
}
function map(r: Row): RoutePromotion {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    routeId: r.route_id,
    groupId: r.group_id,
    billingCycle: r.billing_cycle,
    priceMinor: Number(r.price_minor),
    currency: r.currency,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
    autoRenew: r.auto_renew,
    createdAt: r.created_at,
    version: r.version,
    platformChargeId: r.platform_charge_id,
  };
}
