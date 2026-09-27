import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

import { FareBreakup, type FareLine, type TaxComponent } from './fare-breakup';

/**
 * ============================================================================
 *  Pricing engine — deterministic fare computation
 * ============================================================================
 *
 * Given a base fare and a set of inputs (occupancy, days-to-departure, seat
 * type, coupon), produce a fully-decomposed `FareBreakup`. Pure and
 * deterministic → the same inputs always yield the same price, which is what
 * makes a price "quote" trustworthy and testable.
 *
 * The pipeline, in order (order matters — dynamic applies before discounts,
 * discounts before tax):
 *
 *   base
 *    → dynamic yield adjustment   (occupancy + advance-purchase multipliers)
 *    → coupon / discount          (percentage or flat, capped)
 *    → pickup / drop charges      (flat per seat, never discounted)
 *    → GST                        (CGST+SGST intra-state, or IGST inter-state)
 *   = total
 *
 * DESIGN NOTES
 *  - Multipliers are applied to the BASE, not compounded on each other, so the
 *    contribution of each rule is independently auditable and a stacked set of
 *    rules can't silently explode a fare.
 *  - Every rounding is explicit (Money rounds half-up), so the breakup always
 *    reconciles to the paisa.
 *  - GST on bus tickets in India is either exempt, 5% (non-AC) or 5%/higher
 *    (AC) — the exact rate is a policy input, not hard-coded, because it changes
 *    and varies by vehicle class and geography.
 */

export interface YieldLadder {
  /** Occupancy thresholds → multiplier. e.g. [{atPct:50,mult:1.1},{atPct:80,mult:1.25}] */
  occupancy: { atPct: number; mult: number }[];
  /** Advance-purchase curve: fewer days to departure → higher multiplier. */
  advancePurchase: { withinDays: number; mult: number }[];
  /** Hard ceiling so no combination of rules can exceed this × base. */
  maxMultiplier: number;
  /** Floor so a deep-discount rule can't sell below cost. */
  minMultiplier: number;
}

export const NO_YIELD: YieldLadder = {
  occupancy: [],
  advancePurchase: [],
  maxMultiplier: 1,
  minMultiplier: 1,
};

export interface Coupon {
  code: string;
  kind: 'percent' | 'flat';
  /** For percent: 0..100. For flat: minor units. */
  value: number;
  /** Max discount in minor units (caps a percentage coupon). */
  maxDiscountMinor?: number;
  /** Minimum fare (minor units) the coupon applies to. */
  minFareMinor?: number;
}

export interface TaxPolicy {
  /** Total GST rate, e.g. 5. Split into CGST/SGST for intra-state. */
  gstRatePct: number;
  /** True when origin & destination are in different states → IGST. */
  interState: boolean;
  /** GST-exempt (e.g. non-AC stage carriage in some interpretations). */
  exempt?: boolean;
}

export interface PriceRequest {
  currency: CurrencyCode;
  baseFareMinor: number;
  /** Current trip occupancy 0..100, for the yield ladder. */
  occupancyPct: number;
  /** Days between now and departure, for advance-purchase pricing. */
  daysToDeparture: number;
  yield?: YieldLadder;
  coupon?: Coupon | null;
  tax: TaxPolicy;
  /**
   * Operator fare floor / ceiling per seat, applied AFTER dynamic yield (so
   * demand pricing can never breach them) and BEFORE coupons (a coupon is a
   * deliberate promotion). Omitted = no bounds (behaviour unchanged).
   */
  bounds?: { floorMinor?: number | null; ceilingMinor?: number | null };
  /**
   * Flat per-seat charges — a far pickup or a door-step drop — added AFTER any
   * coupon (a coupon never discounts them) and BEFORE GST (they are part of the
   * taxable fare). Zero amounts are ignored.
   */
  extras?: { label: string; amountMinor: number }[];
}

export class PricingEngine {
  /** Compute the full fare breakup for one seat. */
  static price(req: PriceRequest): FareBreakup {
    if (req.baseFareMinor < 0) {
      throw new DomainError(ErrorCode.PRICING_NO_FARE_DEFINED, 'Base fare cannot be negative');
    }
    const base = Money.of(req.baseFareMinor, req.currency);
    const lines: FareLine[] = [];

    // ── 1. dynamic yield ──
    const ladder = req.yield ?? NO_YIELD;
    const multiplier = clamp(
      occupancyMultiplier(ladder, req.occupancyPct) *
        advanceMultiplier(ladder, req.daysToDeparture),
      ladder.minMultiplier,
      ladder.maxMultiplier,
    );
    if (multiplier !== 1) {
      // Adjustment is (base * mult) - base, so the base line stays clean.
      const adjusted = base.times(multiplier);
      const delta = adjusted.minus(base);
      lines.push({
        kind: 'dynamic',
        label: multiplier > 1 ? 'Demand adjustment' : 'Promotional adjustment',
        amount: delta,
      });
    }

    // ── 1b. operator floor / ceiling (281 / 282) ──
    if (req.bounds) {
      const afterYield = base.plus(
        lines.reduce((a, l) => a.plus(l.amount), Money.zero(req.currency)),
      );
      const ceiling = req.bounds.ceilingMinor;
      const floor = req.bounds.floorMinor;
      if (ceiling !== null && ceiling !== undefined && afterYield.minor > ceiling) {
        lines.push({
          kind: 'dynamic',
          label: 'Fare ceiling',
          amount: Money.of(ceiling - afterYield.minor, req.currency),
        });
      } else if (floor !== null && floor !== undefined && afterYield.minor < floor) {
        lines.push({
          kind: 'dynamic',
          label: 'Fare floor',
          amount: Money.of(floor - afterYield.minor, req.currency),
        });
      }
    }

    const netBeforeDiscount = base.plus(
      lines.reduce((a, l) => a.plus(l.amount), Money.zero(req.currency)),
    );

    // ── 2. coupon / discount ──
    if (req.coupon) {
      const discount = computeCoupon(req.coupon, netBeforeDiscount, req.currency);
      if (discount.isPositive()) {
        lines.push({
          kind: 'coupon',
          label: `Coupon ${req.coupon.code}`,
          amount: discount.negate(),
        });
      }
    }

    // ── 2b. pickup / drop charges ──
    for (const x of req.extras ?? []) {
      if (x.amountMinor < 0) {
        throw new DomainError(ErrorCode.COMMON_VALIDATION, 'A charge cannot be negative');
      }
      if (x.amountMinor > 0) {
        lines.push({
          kind: 'surcharge',
          label: x.label,
          amount: Money.of(x.amountMinor, req.currency),
        });
      }
    }

    // ── 3. tax on the net fare ──
    const netFare = base
      .plus(lines.reduce((a, l) => a.plus(l.amount), Money.zero(req.currency)))
      .clampZero();
    const taxes = computeTaxes(req.tax, netFare, req.currency);

    return FareBreakup.build({ currency: req.currency, base, lines, taxes });
  }

  /**
   * Price N seats, splitting any flat coupon fairly across them with no paisa
   * lost. Percentage coupons and taxes are naturally per-seat.
   */
  static priceMany(req: PriceRequest, seatCount: number): FareBreakup[] {
    if (seatCount < 1) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'seatCount must be >= 1');
    // A flat coupon applies once to the whole booking; distribute it.
    if (req.coupon?.kind === 'flat') {
      const perSeatBase = PricingEngine.price({ ...req, coupon: null });
      const totalFlat = Math.min(req.coupon.value, perSeatBase.netFare.minor * seatCount);
      const shares = Money.of(totalFlat, req.currency).allocate(seatCount);
      return shares.map((share) =>
        PricingEngine.price({
          ...req,
          coupon: { code: req.coupon!.code, kind: 'flat', value: share.minor },
        }),
      );
    }
    // Percentage / no coupon: identical per seat.
    return Array.from({ length: seatCount }, () => PricingEngine.price(req));
  }

  /**
   * Same as `priceMany`, but each seat can have its OWN base fare — the
   * per-seat-number override case (window seats, front-row, a specific
   * "lucky" seat number priced differently — see FareRepository.resolveFare's
   * seat-number-override lookup). `baseFaresMinor[i]` corresponds
   * positionally to the i-th seat being priced.
   *
   * A flat coupon still applies ONCE to the whole booking, but now splits
   * proportionally to each seat's OWN fare (via Money.allocate's weighted
   * mode) rather than evenly — a ₹500 seat and a ₹1000 seat sharing a flat
   * ₹100 discount get ₹33 and ₹67 respectively, not ₹50 each, so a seat can
   * never end up discounted below zero relative to its own fare.
   */
  static priceManyDifferent(
    reqTemplate: Omit<PriceRequest, 'baseFareMinor'>,
    baseFaresMinor: number[],
  ): FareBreakup[] {
    if (baseFaresMinor.length < 1)
      throw new DomainError(ErrorCode.COMMON_VALIDATION, 'at least one seat fare is required');
    if (reqTemplate.coupon?.kind === 'flat') {
      const perSeatNoCoupon = baseFaresMinor.map((baseFareMinor) =>
        PricingEngine.price({ ...reqTemplate, baseFareMinor, coupon: null }),
      );
      const totalNet = perSeatNoCoupon.reduce((sum, b) => sum + b.netFare.minor, 0);
      const totalFlat = Math.min(reqTemplate.coupon.value, totalNet);
      const weights = perSeatNoCoupon.map((b) => b.netFare.minor);
      const shares = Money.of(totalFlat, reqTemplate.currency).allocate(weights);
      return baseFaresMinor.map((baseFareMinor, i) =>
        PricingEngine.price({
          ...reqTemplate,
          baseFareMinor,
          coupon: { code: reqTemplate.coupon!.code, kind: 'flat', value: shares[i].minor },
        }),
      );
    }
    // Percentage / no coupon: each seat prices independently off its own fare.
    return baseFaresMinor.map((baseFareMinor) =>
      PricingEngine.price({ ...reqTemplate, baseFareMinor }),
    );
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function occupancyMultiplier(ladder: YieldLadder, occupancyPct: number): number {
  // Highest threshold at or below the current occupancy wins.
  let mult = 1;
  for (const step of [...ladder.occupancy].sort((a, b) => a.atPct - b.atPct)) {
    if (occupancyPct >= step.atPct) mult = step.mult;
  }
  return mult;
}

function advanceMultiplier(ladder: YieldLadder, daysToDeparture: number): number {
  // Tightest window that still contains the days-to-departure wins (last-minute
  // = higher price). Steps are "within N days".
  let mult = 1;
  for (const step of [...ladder.advancePurchase].sort((a, b) => b.withinDays - a.withinDays)) {
    if (daysToDeparture <= step.withinDays) mult = step.mult;
  }
  return mult;
}

function computeCoupon(coupon: Coupon, fare: Money, currency: CurrencyCode): Money {
  if (coupon.minFareMinor && fare.minor < coupon.minFareMinor) return Money.zero(currency);
  if (coupon.kind === 'percent') {
    if (coupon.value < 0 || coupon.value > 100) {
      throw new DomainError(ErrorCode.PRICING_COUPON_INVALID, 'Percent coupon must be 0..100');
    }
    let discount = fare.percent(coupon.value);
    if (coupon.maxDiscountMinor !== undefined) {
      discount = Money.min(discount, Money.of(coupon.maxDiscountMinor, currency));
    }
    return discount;
  }
  // Flat: never discount more than the fare itself.
  return Money.min(Money.of(coupon.value, currency), fare);
}

function computeTaxes(policy: TaxPolicy, netFare: Money, _currency: CurrencyCode): TaxComponent[] {
  if (policy.exempt || policy.gstRatePct <= 0 || netFare.isZero()) return [];
  if (policy.interState) {
    return [
      { name: 'IGST', ratePct: policy.gstRatePct, amount: netFare.percent(policy.gstRatePct) },
    ];
  }
  // Intra-state: split evenly into CGST + SGST, allocating so the two halves
  // sum exactly to the total GST (no lost paisa on an odd amount).
  const totalGst = netFare.percent(policy.gstRatePct);
  const [cgst, sgst] = totalGst.allocate(2);
  const half = policy.gstRatePct / 2;
  return [
    { name: 'CGST', ratePct: half, amount: cgst },
    { name: 'SGST', ratePct: half, amount: sgst },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
