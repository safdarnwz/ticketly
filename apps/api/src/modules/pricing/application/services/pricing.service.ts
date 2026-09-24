import { Injectable } from '@nestjs/common';

import { CacheService } from '@cache';
import {
  AppError,
  daysBetween,
  ErrorCode,
  newId,
  todayIn,
  type StopId,
  type TripId,
} from '@kernel';

import { PricingEngine } from '../../domain/pricing-engine';
import { CouponRepository } from '../../infrastructure/persistence/coupon.repository';
import { FareRepository } from '../../infrastructure/persistence/fare.repository';
import { InventoryRepository, TripRepository } from '../../../scheduling';
import { RouteRepository } from '../../../master-data';
import { adjustmentPct, applyAdjustment } from '../../domain/pricing-rules';

export interface Quote {
  quoteId: string;
  tripId: TripId;
  fromSeq: number;
  toSeq: number;
  fromStopId: StopId;
  toStopId: StopId;
  seatType: string;
  perSeat: Record<string, unknown>;
  /** Per-seat breakdown when seatNumbers were provided — empty when only a seatCount was given (no specific seats known yet, e.g. some OTA integrations). */
  seatFares: { seatNumber: string; totalMinor: number }[];
  totalMinor: number;
  currency: string;
  expiresAt: string;
}

/**
 * Pricing service — produces a firm, short-lived **quote** for a specific trip
 * and segment.
 *
 * Why quotes: a passenger sees a price, spends two minutes filling passenger
 * details, and by the time they pay the occupancy (and therefore the dynamic
 * price) may have moved. A quote pins the price for a short window (default 3
 * min); booking (Part 7) re-validates the quote and refuses a stale one rather
 * than silently charging a different amount. The quote is cached, not stored, so
 * it evaporates on expiry with no cleanup.
 */
@Injectable()
export class PricingService {
  private static readonly QUOTE_TTL_SECONDS = 180;

  constructor(
    private readonly fares: FareRepository,
    private readonly coupons: CouponRepository,
    private readonly inventory: InventoryRepository,
    private readonly trips: TripRepository,
    private readonly routes: RouteRepository,
    private readonly cache: CacheService,
  ) {}

  async quote(input: {
    tripId: TripId;
    fromStopId: StopId;
    toStopId: StopId;
    seatType: string;
    /** Preferred — specific seats the customer actually picked on the seat map. Enables per-seat-number fare overrides (see FareRepository.seatOverridesFor) and an accurate per-seat price breakdown. */
    seatNumbers?: string[];
    /** Fallback for callers with no seat-map (e.g. some OTA integrations quoting before seat selection) — every seat prices identically off the seat-type rule; no per-seat override can apply since we don't know which seats. */
    seatCount?: number;
    couponCode?: string;
  }): Promise<Quote> {
    const seatNumbers = input.seatNumbers ?? [];
    const seatCount = seatNumbers.length > 0 ? seatNumbers.length : (input.seatCount ?? 0);
    if (seatCount < 1)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'seatNumbers or seatCount is required',
      });

    const trip = await this.trips.getById(input.tripId);
    if (trip.status !== 'open') {
      throw new AppError(ErrorCode.INVENTORY_TRIP_CLOSED, 422, {
        message: 'Trip is not open for booking',
      });
    }

    const seg = await this.inventory.resolveSegment(input.tripId, input.fromStopId, input.toStopId);
    if (!seg)
      throw new AppError(ErrorCode.INVENTORY_SEGMENT_INVALID, 422, {
        message: 'Invalid boarding/dropping combination',
      });

    // The fare row is chosen by seatType, so the seats named MUST be of that
    // type — otherwise a sleeper could be priced (and sold) at the seater fare
    // just by sending seatType: 'seater'. Never trust the client's label.
    if (seatNumbers.length > 0) {
      const dup = seatNumbers.find((s, i) => seatNumbers.indexOf(s) !== i);
      if (dup)
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Seat ${dup} was selected more than once`,
        });
      const types = await this.inventory.seatTypes(input.tripId, seatNumbers);
      const unknown = seatNumbers.filter((s) => !types.get(s)?.bookable);
      if (unknown.length)
        throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
          message: `Not a bookable seat on this trip: ${unknown.join(', ')}`,
        });
      const wrong = seatNumbers.filter((s) => types.get(s)!.seatType !== input.seatType);
      if (wrong.length) {
        throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
          message: `Seat(s) ${wrong.join(', ')} are not ${input.seatType} seats — quote each seat type separately`,
          details: {
            seatTypes: Object.fromEntries(seatNumbers.map((s) => [s, types.get(s)!.seatType])),
          },
        });
      }
    }

    const available = await this.inventory.availableCount(input.tripId, seg.fromSeq, seg.toSeq);
    if (available < seatCount) {
      throw new AppError(ErrorCode.INVENTORY_SEAT_UNAVAILABLE, 422, {
        message: `Only ${available} seat(s) available on this segment`,
        details: { available },
      });
    }

    const fare = await this.fares.resolveFare({
      routeId: trip.routeId,
      fromStopId: input.fromStopId,
      toStopId: input.toStopId,
      seatType: input.seatType,
      distanceM: 0,
      journeyDate: trip.journeyDate,
    });
    if (!fare)
      throw new AppError(ErrorCode.PRICING_NO_FARE_DEFINED, 422, {
        message: 'No fare is defined for this segment',
      });

    // Per-seat-number overrides — e.g. seat "1" (front row) or a window seat
    // priced differently from the rest of the same seat type. Falls back to
    // the seat-type fare for any seat with no override on file.
    const overrides =
      seatNumbers.length > 0
        ? await this.fares.seatOverridesFor(fare.farePlanId, seatNumbers)
        : new Map<string, number>();
    const baseFaresMinor =
      seatNumbers.length > 0
        ? seatNumbers.map((s) => overrides.get(s) ?? fare.baseFareMinor)
        : Array.from({ length: seatCount }, () => fare.baseFareMinor);

    // Operator pricing controls: peak/off-peak by departure time + manual trip
    // adjustment on the base fare; floor/ceiling applied inside the engine
    // after dynamic yield.
    const controls = await this.fares.pricingControls(trip.routeId, trip.id);
    const ist = new Date(trip.departsAt.getTime() + 330 * 60_000);
    const pct = adjustmentPct({
      departureMinuteLocal: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
      peakWindows: controls.peakWindows,
      tripPct: controls.tripPct,
    });
    const adjustedBaseFares =
      pct === 0 ? baseFaresMinor : baseFaresMinor.map((f) => applyAdjustment(f, pct));
    const routePricing = await this.fares.routePricing(trip.routeId);
    const interState = await this.routes.isInterState(trip.routeId);
    const occupancyPct =
      trip.totalSeats > 0 ? Math.round(((trip.totalSeats - available) / trip.totalSeats) * 100) : 0;
    const daysOut = Math.max(0, daysBetween(todayIn(), trip.journeyDate));

    const coupon = input.couponCode
      ? await this.coupons.validateAndLoad(input.couponCode, undefined, trip.journeyDate)
      : null;
    if (input.couponCode && !coupon) {
      throw new AppError(ErrorCode.PRICING_COUPON_INVALID, 422, {
        message: 'Coupon is invalid or expired',
      });
    }

    const reqTemplate = {
      currency: fare.currency as never,
      occupancyPct,
      daysToDeparture: daysOut,
      yield: routePricing.ladder,
      coupon,
      tax: { gstRatePct: routePricing.gstRatePct, interState },
      bounds:
        controls.floorMinor !== null || controls.ceilingMinor !== null
          ? { floorMinor: controls.floorMinor, ceilingMinor: controls.ceilingMinor }
          : undefined,
    };
    const breakups = PricingEngine.priceManyDifferent(reqTemplate, adjustedBaseFares);

    const totalMinor = breakups.reduce((sum, b) => sum + b.total.minor, 0);
    // Aggregated across ALL seats (not just breakups[0]) — this is what
    // actually gets persisted on the booking (see BookingService.hold) and
    // later split into the ledger's tax_payable account (see
    // PaymentService.onCaptured). Losing this into a single per-seat sample
    // was exactly how GST silently vanished into the operator's payable
    // instead of being tracked as a separate liability.
    const totalBaseMinor = breakups.reduce((sum, b) => sum + b.base.minor, 0);
    const totalDiscountMinor = breakups.reduce((sum, b) => sum + b.discountTotal.minor, 0);
    const totalTaxMinor = breakups.reduce((sum, b) => sum + b.taxTotal.minor, 0);
    const quoteId = newId();
    const quote: Quote = {
      quoteId,
      tripId: input.tripId,
      fromSeq: seg.fromSeq,
      toSeq: seg.toSeq,
      fromStopId: input.fromStopId,
      toStopId: input.toStopId,
      seatType: input.seatType,
      perSeat: breakups[0].toJSON(),
      seatFares: seatNumbers.map((s, i) => ({
        seatNumber: s,
        totalMinor: breakups[i].total.minor,
      })),
      totalMinor,
      currency: fare.currency,
      expiresAt: new Date(Date.now() + PricingService.QUOTE_TTL_SECONDS * 1000).toISOString(),
    };

    // Cache the full quote so booking can re-validate it by id.
    await this.cache.set(
      quoteId,
      {
        ...quote,
        couponCode: input.couponCode ?? null,
        seatCount,
        totalBaseMinor,
        totalDiscountMinor,
        totalTaxMinor,
      },
      {
        namespace: 'quote',
        ttlSeconds: PricingService.QUOTE_TTL_SECONDS,
      },
    );

    return quote;
  }

  /** Fetch a quote for booking re-validation. Returns null if expired/unknown. */
  async getQuote(quoteId: string): Promise<
    | (Quote & {
        couponCode: string | null;
        seatCount: number;
        totalBaseMinor: number;
        totalDiscountMinor: number;
        totalTaxMinor: number;
      })
    | undefined
  > {
    return this.cache.get(quoteId, { namespace: 'quote' });
  }
}
