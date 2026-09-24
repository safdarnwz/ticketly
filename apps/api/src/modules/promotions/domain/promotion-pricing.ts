export type PromotionBillingCycle = 'daily' | 'weekly' | 'monthly';

/**
 * How many days one unit of a rate "bucket" covers — used only for the
 * bucket-decomposition pricing below, never for auto-computing a window
 * from "now" (the operator picks explicit calendar start/end dates
 * instead — see validateDateRange/computeBucketPrice).
 */
export function cycleDays(cycle: PromotionBillingCycle): number {
  if (cycle === 'daily') return 1;
  if (cycle === 'weekly') return 7;
  return 30;
}

const MAX_PROMOTION_DAYS = 365;

/**
 * Validates an operator-chosen calendar date-range (from a date-picker,
 * not a fixed "starting now" cycle) and returns the inclusive day-count.
 * startDate/endDate are LocalDate-shaped (YYYY-MM-DD) calendar days, not
 * instants — "12 Oct to 14 Oct" is unambiguously a 3-day promotion (12th,
 * 13th, 14th) regardless of what time of day the purchase happens.
 *
 * Edge cases this rejects outright rather than silently coercing:
 *   - endDate before startDate — a reversed range is a user error, not
 *     something to auto-swap and guess at.
 *   - startDate before today — no retroactive promotion; the platform
 *     doesn't sell ad-slots for search results that already happened.
 *     Today itself IS valid (an operator can start promoting immediately).
 *   - a range longer than a year — not a real product need, and an
 *     unbounded range is how a fat-fingered end-date (e.g. a typo'd year)
 *     turns into an accidental multi-year, massively-overpriced charge.
 */
export function validateDateRange(
  startDate: string,
  endDate: string,
  today: string,
): { days: number } {
  if (endDate < startDate) {
    throw new Error('End date cannot be before start date');
  }
  if (startDate < today) {
    throw new Error('Start date cannot be in the past');
  }
  const start = new Date(startDate + 'T00:00:00Z').getTime();
  const end = new Date(endDate + 'T00:00:00Z').getTime();
  const days = Math.round((end - start) / 86_400_000) + 1; // inclusive of both ends
  if (days > MAX_PROMOTION_DAYS) {
    throw new Error(
      `A promotion cannot run longer than ${MAX_PROMOTION_DAYS} days in one purchase`,
    );
  }
  return { days };
}

export interface PromotionRateInputs {
  dailyRateMinor: number;
  weeklyRateMinor: number;
  monthlyRateMinor: number;
}

/**
 * Prices an EXACT day-count using the best combination of the three rate
 * buckets — the same "greedy denomination" approach hotel/car-rental
 * pricing uses (a week booked gets the weekly rate for those 7 days, extra
 * days on top at the daily rate), rather than forcing the operator into
 * whichever single fixed cycle is closest and either overcharging (round
 * up to a full month for a 32-day promotion) or undercharging (force a
 * 10-day promotion into the cheaper weekly bucket, losing 3 days of
 * revenue). This requires monthlyRateMinor/30 <= weeklyRateMinor/7 <=
 * dailyRateMinor to actually behave as a volume discount — the super-admin
 * rate-card isn't validated to enforce that ordering here (a rate card is
 * the platform's own pricing decision), but a rate card that inverts it
 * would make this decomposition pick smaller buckets than expected, never
 * silently overcharge.
 */
export function computeBucketPrice(
  days: number,
  rates: PromotionRateInputs,
): { totalMinor: number; breakdown: { months: number; weeks: number; days: number } } {
  let remaining = days;
  const months = Math.floor(remaining / 30);
  remaining -= months * 30;
  const weeks = Math.floor(remaining / 7);
  remaining -= weeks * 7;
  const remainingDays = remaining;

  const totalMinor =
    months * rates.monthlyRateMinor +
    weeks * rates.weeklyRateMinor +
    remainingDays * rates.dailyRateMinor;
  return { totalMinor, breakdown: { months, weeks, days: remainingDays } };
}

/** The [startsAt, endsAt) instant-window for a validated calendar date-range — start of the start-day to end of the end-day, in the platform's own reference timezone (IST, since every operator and customer here is India-based). */
export function dateRangeToWindow(
  startDate: string,
  endDate: string,
): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(startDate + 'T00:00:00+05:30');
  const endsAt = new Date(new Date(endDate + 'T00:00:00+05:30').getTime() + 86_400_000);
  return { startsAt, endsAt };
}

export interface PromotedCandidate {
  routeId: string;
  /** When this promotion was purchased — the tie-breaker when the candidate count is small enough that no rotation is needed. */
  purchasedAt: Date;
}

/**
 * A cheap, deterministic string hash (not cryptographic — this is a fairness
 * lottery, not a security boundary) used to rotate which promoted routes
 * occupy the limited top-N slots when MORE operators are promoting than
 * there is room to show. Same inputs always produce the same output within
 * one rotation window, which is what makes results stable/cacheable within
 * that window while still rotating fairly across windows.
 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/**
 * Which promoted routes get the (scarce) top-N slots THIS rotation window.
 *
 * - 0 candidates: nothing to select.
 * - <= maxSlots candidates: everyone currently promoting fits — no need to
 *   exclude anyone, shown oldest-purchase-first (a simple, defensible
 *   "first come" ordering when there's no scarcity to ration).
 * - > maxSlots candidates: genuine scarcity — MORE operators are paying for
 *   promotion on this route/search than there is room to show all of them.
 *   Rather than the same highest-bidder or earliest-purchaser dominating
 *   every single search indefinitely (which would make promotion nearly
 *   worthless for everyone else who paid), this rotates hourly: which
 *   maxSlots-of-N show is re-randomized (deterministically) every hour, so
 *   over a day every paying operator gets roughly equal top-3 exposure
 *   instead of only the first N who happened to purchase first.
 *
 * `rotationBucket` is the caller's own choice of "how often to rotate" —
 * SearchService passes an hour-granularity timestamp bucket, so this
 * function itself has no notion of wall-clock time (pure, testable).
 */
export function selectTopPromoted(
  candidates: readonly PromotedCandidate[],
  maxSlots: number,
  rotationBucket: string,
): PromotedCandidate[] {
  if (candidates.length <= maxSlots) {
    return [...candidates].sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());
  }
  return [...candidates]
    .sort(
      (a, b) =>
        hashString(`${a.routeId}:${rotationBucket}`) - hashString(`${b.routeId}:${rotationBucket}`),
    )
    .slice(0, maxSlots);
}

/**
 * Reorders an already-sorted (by the customer's own chosen sort/filter)
 * result list so that up to `maxSlots` promoted-route results come first,
 * in the fairness-rotated order selectTopPromoted produced, followed by
 * every OTHER result (promoted-but-not-selected-this-rotation, and
 * never-promoted) in their ORIGINAL relative order — the customer's actual
 * sort choice still governs everything below the promoted slots; it's
 * never discarded, only outranked at the very top.
 *
 * Generic over T so this works against the real SearchResult shape without
 * this domain file needing to import it (keeps this module dependency-free
 * and independently testable).
 */
export function bubblePromotedToTop<T extends { tripId: string; routeId: string }>(
  results: readonly T[],
  promotedRouteIds: ReadonlySet<string>,
  maxSlots: number,
  rotationBucket: string,
  purchasedAtByRoute: ReadonlyMap<string, Date>,
): T[] {
  if (promotedRouteIds.size === 0) return [...results];

  // Only routes that actually have a matching result in THIS search are
  // real candidates — a route promoted platform-wide with zero trips
  // matching today's search has nothing to bubble.
  const candidateRouteIds = new Set(
    results.map((r) => r.routeId).filter((id) => promotedRouteIds.has(id)),
  );
  if (candidateRouteIds.size === 0) return [...results];

  const candidates: PromotedCandidate[] = [...candidateRouteIds].map((routeId) => ({
    routeId,
    purchasedAt: purchasedAtByRoute.get(routeId) ?? new Date(0),
  }));
  const selected = selectTopPromoted(candidates, maxSlots, rotationBucket);
  const selectedRouteIds = new Set(selected.map((c) => c.routeId));

  // Within the selected promoted set, if a route has multiple matching
  // trips in this search, only its FIRST (by the customer's own sort) trip
  // takes a promoted slot — promotion buys a route visibility boost, not N
  // duplicate top-3 entries for the same operator's every single departure
  // time, which would crowd out other paying operators AND look like spam
  // to the customer.
  const seenPromotedRoute = new Set<string>();
  const promoted: T[] = [];
  const rest: T[] = [];
  for (const r of results) {
    if (selectedRouteIds.has(r.routeId) && !seenPromotedRoute.has(r.routeId)) {
      seenPromotedRoute.add(r.routeId);
      promoted.push(r);
    } else {
      rest.push(r);
    }
  }
  // promoted[] is currently in the customer's sort-order, not the fairness
  // rotation's order — re-sort just this small slice to match selectTopPromoted's
  // actual ordering, since THAT ordering is the fairness guarantee being sold.
  promoted.sort(
    (a, b) =>
      selected.findIndex((c) => c.routeId === a.routeId) -
      selected.findIndex((c) => c.routeId === b.routeId),
  );
  return [...promoted, ...rest];
}
