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
    if (input.routeIds.length === 0)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'Select at least one route to promote',
      });
    const uniqueRouteIds = [...new Set(input.routeIds)];
    const isMultiRoute = uniqueRouteIds.length > 1;

    const today = todayIn();
    let days: number;
    try {
      ({ days } = validateDateRange(input.startDate, input.endDate, today));
    } catch (err) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: (err as Error).message });
    }
    const window = dateRangeToWindow(input.startDate, input.endDate);

    // Every route must actually belong to THIS operator — promoting a
    // route you don't own isn't a pricing edge case, it's a straightforward
    // authorization check that has to happen before anything else here.
    for (const routeId of uniqueRouteIds) {
      const owned = await this.routes.findById(routeId);
      if (!owned)
        throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
          message: `Route ${routeId} does not belong to your fleet`,
        });
    }

    // All three buckets needed together for the decomposition — a rate
    // card missing any one of them can't price an arbitrary day-count.
    const [dailyRate, weeklyRate, monthlyRate] = await Promise.all([
      this.promotions.rateFor('daily', isMultiRoute),
      this.promotions.rateFor('weekly', isMultiRoute),
      this.promotions.rateFor('monthly', isMultiRoute),
    ]);
    if (!dailyRate || !weeklyRate || !monthlyRate) {
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
        message: 'Pricing is not fully configured for this plan yet — contact the platform',
      });
    }
    const currency = dailyRate.currency;
    const { totalMinor: perRouteMinor } = computeBucketPrice(days, {
      dailyRateMinor: dailyRate.priceMinor,
      weeklyRateMinor: weeklyRate.priceMinor,
      monthlyRateMinor: monthlyRate.priceMinor,
    });

    const groupId = newId();

    return this.uow.run({ name: 'promotion.purchase', tenantId }, async () => {
      // A route already promoted during any part of this SAME window
      // blocks the purchase — not a blanket "any active promotion ever"
      // check, since date-ranges are now explicit and non-overlapping
      // future promotions for the same route are perfectly legitimate
      // (e.g. promoting a route for this week AND separately for a
      // festival week two months from now). Overlap, not mere existence,
      // is what actually double-sells the same search-result slot.
      for (const routeId of uniqueRouteIds) {
        if (await this.promotions.hasOverlap(routeId, window.startsAt, window.endsAt)) {
          throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
            message: `Route ${routeId} already has a promotion overlapping these dates`,
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

      const totalMinor = perRouteMinor * uniqueRouteIds.length;
      // Billed via the existing platform_charges mechanism — same "rolls
      // into the next settlement that can cover it" machinery per-bus-fees
      // already use, rather than building a parallel billing pipeline for
      // what is, from the settlement engine's point of view, just another
      // kind of platform charge against the operator.
      const platformChargeId = await this.charges.add({
        tenantId,
        kind: 'route_promotion',
        amountMinor: totalMinor,
        currency,
        description: `Route promotion — ${days} day(s), ${input.startDate} to ${input.endDate}, ${uniqueRouteIds.length} route${uniqueRouteIds.length > 1 ? 's' : ''}`,
      });
      if (!platformChargeId) throw new Error('Promotion charge was not recorded');

      // Activated immediately — platform_charges are settled against a
      // FUTURE payout, not paid upfront by card, so there's no separate
      // "waiting for payment to clear" state to sit in here (unlike a
      // customer's booking payment). The charge itself is what eventually
      // gets deducted from the operator's own settlement. A FUTURE-dated
      // startsAt simply means the row is active but not yet SHOWING in
      // search (see SearchService.activePromotionsForRoutes' own
      // starts_at <= now check) — no separate "scheduled" status needed.
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
      if (promo.status !== 'active' && promo.status !== 'pending_payment') {
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'This promotion is already cancelled or has ended',
        });
      }

      let adjustedMinor = 0;
      if (promo.status === 'active' && promo.platformChargeId) {
        // Whole days, cut at midnight IST; the cancellation day is charged
        // (see earlyCancelCredit).
        const nextMidnight = new Date(
          new Date(`${todayIn()}T00:00:00+05:30`).getTime() + 86_400_000,
        );
        const { unusedDays: unusedFullDays, creditMinor: unusedMinor } = earlyCancelCredit({
          priceMinor: promo.priceMinor,
          startsAt: promo.startsAt,
          endsAt: promo.endsAt,
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
