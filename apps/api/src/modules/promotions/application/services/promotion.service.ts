import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, newId, requireTenantId, todayIn, type RouteId } from '@kernel';

import {
  PromotionRepository,
  type PromotionPricingRule,
  type RoutePromotion,
} from '../../infrastructure/persistence/promotion.repository';
import {
  validateDateRange,
  dateRangeToWindow,
  computeBucketPrice,
  earlyCancelCredit,
  type PromotionBillingCycle,
} from '../../domain/promotion-pricing';
import { RouteRepository } from '../../../master-data';
import { PlatformChargeRepository } from '../../../platform-settings';

@Injectable()
export class PromotionService {
  constructor(
    private readonly promotions: PromotionRepository,
    private readonly routes: RouteRepository,
    private readonly charges: PlatformChargeRepository,
    private readonly uow: UnitOfWork,
  ) {}

  // ── Super-admin: rate card ────────────────────────────────────────────
  async currentRates(): Promise<PromotionPricingRule[]> {
    return this.promotions.currentRates();
  }

  async setRate(
    input: { billingCycle: PromotionBillingCycle; isMultiRoute: boolean; priceMinor: number },
    actorUserId: string | null,
  ): Promise<void> {
    if (input.priceMinor < 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: 'Price cannot be negative' });
    await this.promotions.setRate(
      input.billingCycle,
      input.isMultiRoute,
      input.priceMinor,
      actorUserId,
    );
  }

  // ── Operator: purchase ─────────────────────────────────────────────────
  /**
   * Purchases promotion for one or more routes over an EXPLICIT calendar
   * date-range the operator picked (a date-picker's start/end, which may
   * begin today or any future date) — never a fixed "starting now" cycle.
   * Price is the exact day-count, decomposed into the best combination of
   * the daily/weekly/monthly rate buckets (see computeBucketPrice) — an
   * operator promoting for exactly the 12 days they chose pays for 12
   * days' worth of visibility, never rounded up to a full month nor
   * shoehorned into a cheaper bucket that undercharges for the actual
   * duration. 2+ routeIds is what makes this a "multi-route" purchase for
   * PRICING purposes (the multi-route rate applies per-route, typically
   * at a discount vs each route bought separately) — all routes in one
   * call share a single groupId, so they're billed as one platform_charges
   * entry and can be understood together on an invoice later. No separate
   * billing/invoicing exists for this feature at all — the charge rides
   * the SAME platform_charges -> settlement -> the operator's regular
   * settlement statement/invoice that already covers commission and other
   * platform charges, so there is deliberately nothing new for the
   * operator to reconcile against a different bill.
   */
  /**
   * The exact price of promoting `routeCount` routes over a date range — the
   * same computation a purchase charges, so the screen never guesses.
   */
  async quote(input: { routeCount: number; startDate: string; endDate: string }): Promise<{
    days: number;
    perRouteMinor: number;
    totalMinor: number;
    currency: string;
    breakdown: { months: number; weeks: number; days: number };
  }> {
    let days: number;
    try {
      ({ days } = validateDateRange(input.startDate, input.endDate, todayIn()));
    } catch (err) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: (err as Error).message });
    }
    const isMultiRoute = input.routeCount > 1;
    const [dailyRate, weeklyRate, monthlyRate] = await Promise.all([
      this.promotions.rateFor('daily', isMultiRoute),
      this.promotions.rateFor('weekly', isMultiRoute),
      this.promotions.rateFor('monthly', isMultiRoute),
    ]);
    // All three buckets are needed together to price an arbitrary day-count.
    if (!dailyRate || !weeklyRate || !monthlyRate) {
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Pricing is not fully configured for this plan yet — contact the platform',
      });
    }
    const { totalMinor: perRouteMinor, breakdown } = computeBucketPrice(days, {
      dailyRateMinor: dailyRate.priceMinor,
      weeklyRateMinor: weeklyRate.priceMinor,
      monthlyRateMinor: monthlyRate.priceMinor,
    });
    return {
      days,
      perRouteMinor,
      totalMinor: perRouteMinor * input.routeCount,
      currency: dailyRate.currency,
      breakdown,
    };
  }

  /**
   * Purchases promotion for one or more routes over an EXPLICIT calendar
   * date-range the operator picked (today or later). Priced by `quote` —
   * the exact day-count split greedily into monthly/weekly/daily buckets;
   * 2+ routes in one purchase get the multi-route rate. All routes share a
   * groupId and are billed as ONE platform_charges entry, which rides the
   * operator's regular settlement — there is no separate bill.
   *
   * Only this operator's published routes can be promoted (a draft route is
   * not in search, so its promotion would be paid for and never seen). Two
   * requests for the same route are serialised, so a double click cannot
   * pass the overlap check twice and charge twice.
   */
  async purchase(input: {
    routeIds: RouteId[];
    startDate: string;
    endDate: string;
    autoRenew: boolean;
  }): Promise<{
    groupId: string;
    promotionIds: string[];
    totalMinor: number;
    currency: string;
    days: number;
  }> {
    const tenantId = requireTenantId();
    const uniqueRouteIds = [...new Set(input.routeIds)];
    if (uniqueRouteIds.length === 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Select at least one route to promote',
      });

    const names = new Map<string, string>();
    for (const routeId of uniqueRouteIds) {
      const route = await this.routes.findById(routeId);
      if (!route)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
          message: 'One of these routes is not in your fleet',
        });
      if (route.status !== 'published')
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `${route.name} is not published yet — publish it before promoting it`,
        });
      names.set(routeId, route.name);
    }

    const price = await this.quote({
      routeCount: uniqueRouteIds.length,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    const { days, currency, perRouteMinor, totalMinor } = price;
    const window = dateRangeToWindow(input.startDate, input.endDate);
    const groupId = newId();

    return this.uow.run({ name: 'promotion.purchase', tenantId }, async () => {
      await this.promotions.lockRoutes(uniqueRouteIds);
      // Overlap — not mere existence — is what double-sells a search slot:
      // separate future windows for the same route are fine.
      for (const routeId of uniqueRouteIds) {
        if (await this.promotions.hasOverlap(routeId, window.startsAt, window.endsAt)) {
          throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
            message: `${names.get(routeId)} is already promoted on some of these dates`,
          });
        }
      }

      const promotionIds: string[] = [];
      for (const routeId of uniqueRouteIds) {
        const id = await this.promotions.create({
          routeId,
          groupId,
          priceMinor: perRouteMinor,
          currency,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          autoRenew: input.autoRenew,
        });
        promotionIds.push(id);
      }

      // Billed via platform_charges — deducted from a FUTURE settlement, not
      // paid upfront, so the promotions go active straight away (a future
      // start simply is not shown in search yet).
      const platformChargeId = await this.charges.add({
        tenantId,
        kind: 'route_promotion',
        amountMinor: totalMinor,
        currency,
        description: `Route promotion — ${days} day(s), ${input.startDate} to ${input.endDate}, ${uniqueRouteIds.length} route${uniqueRouteIds.length > 1 ? 's' : ''}`,
      });
      if (!platformChargeId) throw new Error('Promotion charge was not recorded');
      for (const id of promotionIds) await this.promotions.activate(id, platformChargeId, 0);

      return { groupId, promotionIds, totalMinor, currency, days };
    });
  }

  async list(status?: string): Promise<RoutePromotion[]> {
    return this.promotions.listForTenant(status);
  }

  /**
   * Cancels an active promotion, adjusting how much the operator owes for
   * it down to only what today actually charges (see the cancel-day
   * reasoning below) — this is NOT a customer-style refund (no money was
   * ever paid out separately to reverse; nothing here touches
   * RefundService or any bank/gateway transfer). The promotion charge is
   * money the operator NETS AGAINST in their own settlement/invoice —
   * it's simply never fully billed if cancelled early:
   *   - if the original platform_charges row is still 'pending' (not yet
   *     rolled into a completed settlement), its amount_minor is reduced
   *     DIRECTLY to the used portion — there's nothing to "give back"
   *     because nothing was ever collected from a still-pending charge.
   *   - if it's already 'settled' (a settlement ran in between purchase
   *     and cancellation, which the row's own version-guarded UPDATE
   *     below would simply not match, since it only touches 'pending'
   *     rows), a NEW negative adjustment charge reduces the operator's
   *     NEXT settlement instead — the completed settlement itself is
   *     never rewritten retroactively.
   * A pending_payment promotion that never activated cancels with
   * nothing to adjust at all (nothing was ever charged for it).
   */
  async cancel(id: string): Promise<{ adjustedMinor: number }> {
    const tenantId = requireTenantId();
    return this.uow.run({ name: 'promotion.cancel', tenantId }, async () => {
      const promo = await this.promotions.findForUpdate(id);
      if (!promo)
        throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Promotion not found' });
      if (!['active', 'paused', 'pending_payment'].includes(promo.status)) {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'This promotion is already cancelled or has ended',
        });
      }

      let adjustedMinor = 0;
      if ((promo.status === 'active' || promo.status === 'paused') && promo.platformChargeId) {
        // Whole days, cut at midnight IST; the cancellation day is charged
        // (see earlyCancelCredit).
        const nextMidnight = new Date(
          new Date(`${todayIn()}T00:00:00+05:30`).getTime() + 86_400_000,
        );
        const { unusedDays: unusedFullDays, creditMinor: unusedMinor } = earlyCancelCredit({
          priceMinor: promo.priceMinor,
          startsAt: promo.startsAt,
          // A paused promotion still owes the days it was paused for (resume
          // would add them back to the end), so count them as unused too.
          endsAt:
            promo.status === 'paused' && promo.pausedAt
              ? new Date(promo.endsAt.getTime() + (Date.now() - promo.pausedAt.getTime()))
              : promo.endsAt,
          nextMidnight,
        });
        const usedMinor = promo.priceMinor - unusedMinor;

        if (unusedMinor > 0) {
          const reduced = await this.charges.reducePending(
            promo.platformChargeId,
            tenantId,
            usedMinor,
            ' (adjusted: cancelled early, today charged in full)',
          );
          if (!reduced) {
            // Already rolled into a completed settlement — that settlement is
            // never rewritten; a negative charge credits the NEXT one instead.
            await this.charges.add({
              tenantId,
              kind: 'route_promotion_adjustment',
              amountMinor: -unusedMinor,
              description: `Promotion ${id} cancelled early — ${unusedFullDays} unused full day(s) credited against your next settlement`,
            });
          }
          adjustedMinor = unusedMinor;
        }
      }

      await this.promotions.cancel(id, promo.version);
      return { adjustedMinor };
    });
  }

  /**
   * Opt-out: pauses an active promotion (stops search visibility, no
   * money moves, no days lost) — see migration 0047's own comment for
   * why this is deliberately NOT the same as cancel(). No prorated
   * refund happens here, on purpose — the operator hasn't given up the
   * remaining days, just paused when they're shown.
   */
  async pause(id: string): Promise<{ status: 'paused' }> {
    const promo = await this.promotions.findForUpdate(id);
    if (!promo)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Promotion not found' });
    if (promo.status !== 'active') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Only an active promotion can be paused',
      });
    }
    const ok = await this.promotions.pause(id, promo.version);
    if (!ok)
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'Promotion was modified concurrently — please retry',
      });
    return { status: 'paused' };
  }

  /**
   * Opt back in: resumes a paused promotion, extending ends_at by however
   * long it was paused — the operator always gets the full number of
   * days they originally paid for, whenever they actually choose to show
   * it, no matter how many pause/resume cycles happen along the way.
   */
  async resume(id: string): Promise<{ status: 'active'; endsAt: Date }> {
    const promo = await this.promotions.findForUpdate(id);
    if (!promo)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Promotion not found' });
    if (promo.status !== 'paused') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Only a paused promotion can be resumed',
      });
    }
    const resumed = await this.promotions.resume(id, promo.version);
    if (!resumed)
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'Promotion was modified concurrently — please retry',
      });
    return { status: 'active', endsAt: resumed.endsAt };
  }
}
