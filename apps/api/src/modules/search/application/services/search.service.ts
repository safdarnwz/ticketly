import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import {
  daysBetween,
  getTenantId,
  mapWithConcurrency,
  runAsTenant,
  todayIn,
  type CityId,
  type LocalDate,
  type RouteId,
  type StopId,
  type TenantId,
  type TripId,
  type VehicleId,
} from '@kernel';
import { Logger, Metrics } from '@observability';

import { TenantRepository } from '../../../tenancy';
import { PricingEngine, FareRepository, ladderFor } from '../../../pricing';
import { AmenityRepository, RouteRepository, type Amenity } from '../../../master-data';
import { PromotionRepository, bubblePromotedToTop } from '../../../promotions';
import { InventoryRepository, TripRepository } from '../../../scheduling';
import { ReviewRepository } from '../../../reviews';

export interface StopRef {
  id: StopId;
  name: string;
}

export interface SearchResult {
  tripId: TripId;
  routeId: RouteId;
  /** Which operator this trip belongs to — the customer picks ONE from the
   *  aggregated list, and the frontend must send this back as `X-Tenant-Id`
   *  on every subsequent call (trip detail, quote, hold, confirm, ticket). */
  tenantId: TenantId;
  operatorName: string;
  /** Where this fare/availability applies from and to — pass these to the quote call. */
  boardingStop: StopRef;
  droppingStop: StopRef;
  departsAt: string;
  arrivesAt: string;
  durationMin: number;
  availableSeats: number;
  fromPriceMinor: number;
  currency: string;
  /** WiFi, charging point, blanket, water bottle etc. — resolved from the trip's assigned vehicle's type. Empty when no vehicle is assigned yet, never guessed. */
  amenities: Amenity[];
  /** Seat types this bus sells (seater / sleeper / semi_sleeper). */
  seatTypes: string[];
  /** Price per seat for each seat type that has a fare (the cheapest is `fromPriceMinor`). */
  fares: { seatType: string; priceMinor: number }[];
  /** Average stars of this bus's published reviews (1 dp) — they stay with the bus that ran, not the route; null until its first review or while no bus is assigned. */
  rating: number | null;
  ratingCount: number;
  /** True when this trip's route currently has an active, paid promotion — the frontend renders the "Prio" badge on these. Never set by anything upstream of promote(). */
  isPromoted?: boolean;
}

/**
 * ============================================================================
 *  Trip search — the sub-10ms hot path
 * ============================================================================
 *
 * www.ticketly.com is ONE central storefront for every operator — there is no
 * tenant bound when this runs (see docs/ACCOUNTS_ONBOARDING.md), so a search
 * aggregates across every ACTIVE tenant, not one. Each tenant's slice of the
 * work runs inside `runAsTenant(id, ...)`, which is what lets the existing,
 * unmodified, tenant-scoped repositories (routes/trips/inventory/fares) work
 * unchanged — they simply run once per tenant instead of once overall. Tenants
 * are searched CONCURRENTLY (bounded by `Promise.all`) so N operators cost
 * roughly one operator's latency, not N times it.
 *
 * Given (origin city, destination city, journey date), return every matching
 * operator's trips with live availability and a "from" price:
 *
 *  1. **Route shortlist** — per tenant, find routes whose city O/D matches.
 *     Small per-tenant set, cache-backed.
 *  2. **Trip fetch** — one indexed query (`trips_search_idx`) for open trips on
 *     those routes for the date. Runs on a replica.
 *  3. **Availability** — ONE aggregate for all trips at once via the leg-bitmap
 *     (`availableCountForTrips`), not a query per trip.
 *  4. **Pricing** — the pure PricingEngine, with fares & policies served from
 *     cache. No DB round trip on a cache hit.
 *  5. **Whole result cached** for a few seconds (SEARCH_RESULTS TTL) with
 *     single-flight, so a burst of identical searches collapses to one compute.
 *
 * The cached availability is display-only; the authoritative seat lock happens
 * at booking time (Part 7).
 */
/** Max operators searched in parallel for one cold search (protects the DB pool). */
const FANOUT_CONCURRENCY = 8;
/** How long an expired search result may still be served while it refreshes in the background. */
const SEARCH_STALE_SECONDS = 60;

type SearchInput = {
  originCityId: CityId;
  destCityId: CityId;
  journeyDate: LocalDate;
  seatType?: string;
  fromStopId?: StopId;
  toStopId?: StopId;
};

@Injectable()
export class SearchService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly routes: RouteRepository,
    private readonly trips: TripRepository,
    private readonly inventory: InventoryRepository,
    private readonly fares: FareRepository,
    private readonly amenities: AmenityRepository,
    private readonly promotions: PromotionRepository,
    private readonly reviews: ReviewRepository,
    private readonly cache: CacheService,
    private readonly metrics: Metrics,
    logger: Logger,
  ) {
    this.log = logger.forContext('SearchService');
  }

  private readonly log: Logger;

  /**
   * Whether this search fans out across every tenant, or stays scoped to
   * ONE, depends entirely on whether a tenant is ALREADY bound in context —
   * `getTenantId()` reflects whatever TenantResolutionMiddleware / the
   * auth guard (JWT or operator API key) resolved for THIS request:
   *
   *   - `app.<slug>.ticketly.com` (a tenant admin's own "Search & Book"),
   *     an operator's own `X-Api-Key`, or an `X-Tenant-Id`
   *     header → a tenant IS bound → search ONLY that one operator. An
   *     operator's staff must never see (or accidentally book into) a
   *     competitor's inventory, and an operator key must never leak every
   *     operator's trips just because it called the same endpoint the public
   *     aggregator uses. (GDS partners search across their contracted
   *     operators via GdsService, which filters by agreement.)
   *   - `www.ticketly.com` (a genuine anonymous customer, no tenant at all)
   *     → nothing bound → aggregate across every active tenant.
   *
   * This one check is what makes a SINGLE search implementation correct for
   * all three callers (public storefront, tenant console, GDS)
   * without three diverging code paths.
   */
  async search(
    input: {
      originCityId: CityId;
      destCityId: CityId;
      journeyDate: LocalDate;
      seatType?: string;
      fromStopId?: StopId;
      toStopId?: StopId;
    },
    /** `promote: false` for a caller that re-sorts and then calls `promote` itself. */
    opts: { promote?: boolean } = {},
  ): Promise<SearchResult[]> {
    const boundTenantId = getTenantId();
    // Every input that changes the result must be in the key — the boarding/
    // dropping stops change the segment, hence availability and price.
    const cacheKey = `${boundTenantId ?? 'all'}:${input.originCityId}:${input.destCityId}:${input.journeyDate}:${input.seatType ?? 'any'}:${input.fromStopId ?? '-'}:${input.toStopId ?? '-'}`;

    const results = await this.cache.getOrLoad<SearchResult[]>(
      cacheKey,
      // stale-while-revalidate: once warm, a popular search is ALWAYS served
      // from memory; an expired entry is refreshed in the background (one
      // refresh per key, single-flight) instead of making a customer wait.
      {
        namespace: CacheNamespace.SEARCH,
        ttlSeconds: CacheTtl.SEARCH_RESULTS,
        staleWhileRevalidateSeconds: SEARCH_STALE_SECONDS,
      },
      async () =>
        boundTenantId
          ? this.computeForTenant(input, boundTenantId)
          : this.computeAcrossTenants(input),
    );

    this.metrics.searchRequests.inc({ cached: 'served' });
    return opts.promote === false ? results : this.promote(results);
  }

  /**
   * Applied AFTER the cache lookup, deliberately never baked into the
   * cached payload itself — the hourly fairness-rotation (see
   * selectTopPromoted's own doc comment) needs to actually rotate every
   * hour regardless of the SEARCH_RESULTS cache's own TTL, which may be
   * longer or shorter than an hour. Recomputing this cheap reorder on
   * every read (cached or fresh) is what keeps the rotation honest.
   */
  async promote(results: SearchResult[]): Promise<SearchResult[]> {
    const routeIds = [...new Set(results.map((r) => r.routeId))];
    if (routeIds.length === 0) return results;
    const active = await this.promotions.activePromotionsForRoutes(routeIds, new Date());
    if (active.length === 0) return results;

    const promotedRouteIds = new Set(active.map((p) => p.routeId as string));
    const purchasedAtByRoute = new Map(active.map((p) => [p.routeId as string, p.createdAt]));
    // Hour-granularity bucket — stable within an hour (so repeated searches
    // in the same hour see the same rotation), rotates hourly across the day.
    const rotationBucket = new Date().toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
    const MAX_PROMOTED_SLOTS = 3;

    return bubblePromotedToTop(
      results,
      promotedRouteIds,
      MAX_PROMOTED_SLOTS,
      rotationBucket,
      purchasedAtByRoute,
    ).map((r) => ({ ...r, isPromoted: promotedRouteIds.has(r.routeId) }));
  }

  /**
   * Aggregate search across operators — scales with the operators that
   * actually SERVE this O/D, not with every operator on the platform:
   *   1. one index-only query (routes_published_od_idx) finds them;
   *   2. only those are searched, at most FANOUT_CONCURRENCY at a time, so a
   *      cold search can never take the whole DB pool from other requests;
   *   3. one slow/broken operator is logged and skipped, never fails the page.
   */
  private async computeAcrossTenants(input: SearchInput): Promise<SearchResult[]> {
    const tenantIds = await this.tenantsServingOd(input.originCityId, input.destCityId);
    if (tenantIds.length === 0) return [];

    const perTenant = await mapWithConcurrency(tenantIds, FANOUT_CONCURRENCY, (tenantId) =>
      runAsTenant(tenantId, () => this.computeForTenant(input, tenantId)).catch((err: unknown) => {
        this.metrics.searchRequests.inc({ cached: 'tenant_error' });
        this.log.error(
          { tenantId, err: err instanceof Error ? err.message : String(err) },
          'search failed for one operator — skipped',
        );
        return [] as SearchResult[];
      }),
    );

    const out = perTenant.flat();
    out.sort((a, b) => a.departsAt.localeCompare(b.departsAt));
    return out;
  }

  /** Active operators with at least one published route for this O/D. */
  private tenantsServingOd(originCityId: CityId, destCityId: CityId): Promise<TenantId[]> {
    return this.routes.tenantsServingOd(originCityId, destCityId);
  }

  private async computeForTenant(
    input: {
      originCityId: CityId;
      destCityId: CityId;
      journeyDate: LocalDate;
      seatType?: string;
      fromStopId?: StopId;
      toStopId?: StopId;
    },
    tenantId: TenantId,
  ): Promise<SearchResult[]> {
    // 1. routes matching the city O/D — one indexed query on routes_od_idx.
    const routeIds = await this.routes.findPublishedByOd(input.originCityId, input.destCityId);
    if (routeIds.length === 0) return [];

    const tenant = await this.tenants.findById(tenantId);
    const operatorName = tenant?.snapshot().displayName ?? 'Operator';

    const today = todayIn();
    const daysOut = Math.max(0, daysBetween(today, input.journeyDate));

    const out: SearchResult[] = [];
    for (const routeId of routeIds) {
      const route = { id: routeId };
      // Three independent reads → one round-trip of latency instead of three.
      const [trips, routePricing, interState, routeStops] = await Promise.all([
        this.trips.findForSearch(route.id, input.journeyDate),
        this.fares.routePricing(route.id),
        this.routes.isInterState(route.id),
        this.routes.stopsWithNames(route.id),
      ]);
      if (trips.length === 0 || routeStops.length < 2) continue;
      const stopRef = (id: StopId | undefined, fallback: 'first' | 'last'): StopRef | null => {
        const s = id
          ? routeStops.find((x) => x.id === id)
          : routeStops[fallback === 'first' ? 0 : routeStops.length - 1];
        return s ? { id: s.id, name: s.name } : null;
      };
      const boardingStop = stopRef(input.fromStopId, 'first');
      const droppingStop = stopRef(input.toStopId, 'last');
      if (!boardingStop || !droppingStop) continue; // the requested stops aren't on this route

      // Resolve segment sequence per trip and batch the availability query.
      const segByTrip = new Map<TripId, { fromSeq: number; toSeq: number }>();
      for (const trip of trips) {
        // Default to whole-trip (first→last) when explicit stops aren't given.
        const seg =
          input.fromStopId && input.toStopId
            ? await this.inventory.resolveSegment(trip.id, input.fromStopId, input.toStopId)
            : { fromSeq: 0, toSeq: trip.stopCount - 1 };
        if (seg) segByTrip.set(trip.id, seg);
      }

      const [availability, seatTypesByTrip] = await Promise.all([
        this.inventory.availableCountForTrips(
          [...segByTrip.entries()].map(([tripId, seg]) => ({ tripId, ...seg })),
        ),
        this.inventory.seatTypesForTrips([...segByTrip.keys()]),
      ]);
      // The segment fare per seat type, resolved once per route (it does not
      // depend on the trip); a type with no fare cannot be sold.
      const fareByType = new Map<string, Awaited<ReturnType<FareRepository['resolveFare']>>>();
      const fareFor = async (seatType: string) => {
        if (!fareByType.has(seatType))
          fareByType.set(
            seatType,
            await this.fares.resolveFare({
              routeId: route.id,
              fromStopId: boardingStop.id,
              toStopId: droppingStop.id,
              seatType,
              distanceM: 0,
              journeyDate: input.journeyDate,
            }),
          );
        return fareByType.get(seatType);
      };

      // Batch-resolved once per route (not per trip) — the amenities
      // customers actually care about at search-time (WiFi, charging
      // point, blanket, water bottle) so results can show them the way
      // every major Indian bus platform does, rather than the customer
      // discovering what's on board only after boarding.
      const vehicleIds = trips.map((t) => t.vehicleId).filter((id): id is VehicleId => id !== null);
      // Each bus carries its own rating: reviews belong to the bus that ran
      // the trip, not to the route (one route runs sleepers, seaters…).
      const [amenitiesByVehicle, busRatings] = await Promise.all([
        this.amenities.forVehicleIds(vehicleIds),
        this.reviews.busRatings(vehicleIds),
      ]);

      for (const trip of trips) {
        const seg = segByTrip.get(trip.id);
        if (!seg) continue;
        const available = availability.get(trip.id) ?? 0;
        if (available === 0) continue;

        const occupancyPct =
          trip.totalSeats > 0
            ? Math.round(((trip.totalSeats - available) / trip.totalSeats) * 100)
            : 0;
        // "from" price: the cheapest seat type this bus sells (or the one
        // asked for), with dynamic yield at current occupancy. A bus with no
        // fare for any of its seat types is not shown — it cannot be booked.
        const offered = seatTypesByTrip.get(trip.id) ?? [];
        const candidates = input.seatType ? offered.filter((t) => t === input.seatType) : offered;
        let breakup: ReturnType<typeof PricingEngine.price> | null = null;
        const fares: { seatType: string; priceMinor: number }[] = [];
        for (const seatType of candidates) {
          const fare = await fareFor(seatType);
          if (!fare) continue;
          const priced = PricingEngine.price({
            currency: fare.currency as never,
            baseFareMinor: fare.baseFareMinor,
            occupancyPct,
            daysToDeparture: daysOut,
            yield: ladderFor(routePricing, trip.serviceId),
            tax: { gstRatePct: routePricing.gstRatePct, interState },
          });
          fares.push({ seatType, priceMinor: priced.total.minor });
          if (!breakup || priced.total.minor < breakup.total.minor) breakup = priced;
        }
        if (!breakup) continue;

        out.push({
          tripId: trip.id,
          routeId: route.id,
          tenantId,
          operatorName,
          boardingStop,
          droppingStop,
          departsAt: trip.departsAt.toISOString(),
          arrivesAt: trip.arrivesAt.toISOString(),
          durationMin: Math.round((trip.arrivesAt.getTime() - trip.departsAt.getTime()) / 60000),
          availableSeats: available,
          fromPriceMinor: breakup.total.minor,
          currency: breakup.currency,
          amenities: trip.vehicleId ? (amenitiesByVehicle.get(trip.vehicleId) ?? []) : [],
          seatTypes: offered,
          fares,
          ...(() => {
            const r = trip.vehicleId ? busRatings.get(trip.vehicleId) : undefined;
            return { rating: r?.count ? r.average : null, ratingCount: r?.count ?? 0 };
          })(),
        });
      }
    }

    return out;
  }
}
