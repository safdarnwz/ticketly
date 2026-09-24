import { Injectable } from '@nestjs/common';

import { type CityId, type LocalDate } from '@kernel';

import { SearchService, type SearchResult } from '../../../search/application/services/search.service';
import { filterAndSort, type SortKey, type SortDir, type TripFilter } from '../../domain/result-filter';
import { buildConnections, type ConnectingJourney, type JourneyLeg } from '../../domain/connecting-journey';

/**
 * ============================================================================
 *  Storefront service
 * ============================================================================
 *
 * The traveller-facing layer over raw trip search (Part 6). It adds the three
 * things a storefront needs beyond "list direct trips":
 *
 *   - **Refined search** — apply the traveller's filters (price, time window,
 *     seat type, amenities, rating, seats) and sort, via the pure engine.
 *   - **Round trip** — one call returns matching onward + return legs.
 *   - **Connecting journeys** — when there's no direct bus, pair an A→hub leg
 *     with a hub→B leg within a sane layover window (pure builder).
 *
 * All the decision logic is pure and unit-tested; this service just orchestrates
 * the underlying searches and hands off to it.
 */
@Injectable()
export class StorefrontService {
  constructor(private readonly search: SearchService) {}

  async searchFiltered(input: {
    originCityId: CityId; destCityId: CityId; journeyDate: LocalDate;
    filter?: TripFilter; sort?: SortKey; sortDir?: SortDir;
  }): Promise<SearchResult[]> {
    const results = await this.search.search({
      originCityId: input.originCityId, destCityId: input.destCityId, journeyDate: input.journeyDate,
    });
    // filterAndSort's amenities filter matches against amenity CODES (strings)
    // — see result-filter.ts's matchesFilter — but SearchResult.amenities is
    // the full Amenity object (id/code/name/icon), not the code alone. Filter
    // against a code-only projection, then map the (filtered + reordered)
    // result back onto the original SearchResult objects by tripId, so the
    // caller still gets the full Amenity objects it expects.
    const filterable = results.map((r) => ({ ...r, amenities: r.amenities.map((a) => a.code) }));
    const filtered = filterAndSort(filterable, input.filter ?? {}, input.sort ?? 'departure', input.sortDir);
    const byTripId = new Map(results.map((r) => [r.tripId, r]));
    return filtered.map((f) => byTripId.get(f.tripId)!);
  }

  async roundTrip(input: {
    originCityId: CityId; destCityId: CityId; onwardDate: LocalDate; returnDate: LocalDate;
    filter?: TripFilter; sort?: SortKey;
  }): Promise<{ onward: SearchResult[]; return: SearchResult[] }> {
    const [onward, ret] = await Promise.all([
      this.searchFiltered({ originCityId: input.originCityId, destCityId: input.destCityId, journeyDate: input.onwardDate, filter: input.filter, sort: input.sort }),
      this.searchFiltered({ originCityId: input.destCityId, destCityId: input.originCityId, journeyDate: input.returnDate, filter: input.filter, sort: input.sort }),
    ]);
    return { onward, return: ret };
  }

  /**
   * Connecting search via an explicit hub city. Runs the two legs concurrently
   * and pairs them with the pure connection builder. A hub is required (hub
   * discovery from the route graph is a future enhancement).
   */
  async searchConnecting(input: {
    originCityId: CityId; hubCityId: CityId; destCityId: CityId; journeyDate: LocalDate;
    minLayoverMin?: number; maxLayoverMin?: number;
  }): Promise<ConnectingJourney[]> {
    const [firstResults, secondResults] = await Promise.all([
      this.search.search({ originCityId: input.originCityId, destCityId: input.hubCityId, journeyDate: input.journeyDate }),
      this.search.search({ originCityId: input.hubCityId, destCityId: input.destCityId, journeyDate: input.journeyDate }),
    ]);

    const toLeg = (r: SearchResult, fromHub: string, toHub: string): JourneyLeg => ({
      tripId: r.tripId, fromHub, toHub, departsAt: r.departsAt, arrivesAt: r.arrivesAt,
      priceMinor: r.fromPriceMinor, availableSeats: r.availableSeats, currency: r.currency,
    });

    return buildConnections(
      firstResults.map((r) => toLeg(r, input.originCityId, input.hubCityId)),
      secondResults.map((r) => toLeg(r, input.hubCityId, input.destCityId)),
      { minLayoverMin: input.minLayoverMin ?? 30, maxLayoverMin: input.maxLayoverMin ?? 360 },
    );
  }
}
