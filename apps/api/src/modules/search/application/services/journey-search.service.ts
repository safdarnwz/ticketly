import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { addDays, formatInstantTime, type CityId, type LocalDate, type StopId } from '@kernel';

import {
  buildConnections,
  layoverWindow,
  type ConnectingJourney,
  type JourneyLeg,
} from '../../domain/connecting-journey';
import {
  filterAndSort,
  type SortDir,
  type SortKey,
  type TripFilter,
} from '../../domain/result-filter';
import {
  ConnectionHubRepository,
  type HubCity,
} from '../../infrastructure/connection-hub.repository';
import { SearchService, type SearchResult } from './search.service';

export interface TripQuery {
  originCityId: CityId;
  destCityId: CityId;
  journeyDate: LocalDate;
  seatType?: string;
  fromStopId?: StopId;
  toStopId?: StopId;
  filter?: TripFilter;
  sort?: SortKey;
  sortDir?: SortDir;
}

/** A connecting-journey leg: a full search result (quote it like any direct trip) + the hub ids. */
export type ConnectingLeg = SearchResult & JourneyLeg;

export interface ConnectingOption extends ConnectingJourney<ConnectingLeg> {
  hubCity: HubCity;
}

/** Hubs tried per connecting search — each costs two (cached) searches. */
const MAX_HUBS = 5;

/**
 * Traveller-facing search on top of the core trip search:
 *  - filtered + sorted direct search (price, departure window, amenities…);
 *  - round trip (onward + return in one call);
 *  - connecting journeys: hub cities are discovered from the route network
 *    across operators, each leg is a normal (priced, availability-checked,
 *    cached) search result, and the pure builder pairs legs within the
 *    layover window. The second leg may depart the next day (overnight
 *    connections).
 */
@Injectable()
export class JourneySearchService {
  constructor(
    private readonly search: SearchService,
    private readonly hubs: ConnectionHubRepository,
    private readonly config: AppConfig,
  ) {}

  /**
   * The customer's filter and sort first, THEN the paid promotion slots on top
   * — sorting after promoting used to push the promoted bus back into place,
   * so an operator paid for a top slot that never showed.
   */
  async trips(q: TripQuery): Promise<SearchResult[]> {
    const results = await this.search.search(
      {
        originCityId: q.originCityId,
        destCityId: q.destCityId,
        journeyDate: q.journeyDate,
        seatType: q.seatType,
        fromStopId: q.fromStopId,
        toStopId: q.toStopId,
      },
      { promote: false },
    );
    // The filter engine matches amenity CODES; results carry full Amenity
    // objects. Filter a code-only projection, then map back by tripId so the
    // caller still gets the full objects.
    const tz = this.config.domain.timezone;
    const filterable = results.map((r) => ({
      ...r,
      amenities: r.amenities.map((a) => a.code),
      operatorRating: r.rating ?? 0,
      departLocal: formatInstantTime(new Date(r.departsAt), tz),
    }));
    const filtered = filterAndSort(filterable, q.filter ?? {}, q.sort ?? 'departure', q.sortDir);
    const byTripId = new Map(results.map((r) => [r.tripId, r]));
    return this.search.promote(filtered.map((f) => byTripId.get(f.tripId)!));
  }

  async roundTrip(
    q: Omit<TripQuery, 'journeyDate' | 'fromStopId' | 'toStopId'> & {
      onwardDate: LocalDate;
      returnDate: LocalDate;
    },
  ) {
    const [onward, ret] = await Promise.all([
      this.trips({ ...q, journeyDate: q.onwardDate }),
      this.trips({
        ...q,
        originCityId: q.destCityId,
        destCityId: q.originCityId,
        journeyDate: q.returnDate,
      }),
    ]);
    return { onward, return: ret };
  }

  async connecting(q: {
    originCityId: CityId;
    destCityId: CityId;
    journeyDate: LocalDate;
    /** Restrict to one hub; otherwise hubs are discovered. */
    hubCityId?: CityId;
    minLayoverMin?: number;
    maxLayoverMin?: number;
  }): Promise<ConnectingOption[]> {
    const hubs = await this.hubs.hubsBetween(
      q.originCityId,
      q.destCityId,
      q.hubCityId ? 1000 : MAX_HUBS,
    );
    const chosen = q.hubCityId ? hubs.filter((h) => h.cityId === q.hubCityId) : hubs;
    const requested = { minLayoverMin: q.minLayoverMin, maxLayoverMin: q.maxLayoverMin };
    const layover = layoverWindow(requested, null);

    const perHub = await Promise.all(
      chosen.map(async (hub) => {
        const [first, secondSameDay, secondNextDay] = await Promise.all([
          this.search.search({
            originCityId: q.originCityId,
            destCityId: hub.cityId,
            journeyDate: q.journeyDate,
          }),
          this.search.search({
            originCityId: hub.cityId,
            destCityId: q.destCityId,
            journeyDate: q.journeyDate,
          }),
          this.search.search({
            originCityId: hub.cityId,
            destCityId: q.destCityId,
            journeyDate: addDays(q.journeyDate, 1),
          }),
        ]);
        const leg = (r: SearchResult, fromHub: string, toHub: string): ConnectingLeg => ({
          ...r,
          fromHub,
          toHub,
          priceMinor: r.fromPriceMinor,
        });
        const second = [...secondSameDay, ...secondNextDay];
        // Each operator decides whether its buses take part, and how long a
        // change onto its bus must (and may) take.
        const rules = await this.hubs.connectionRules([
          ...new Set([...first, ...second].map((r) => r.tenantId)),
        ]);
        const takesPart = (r: SearchResult) => rules.get(r.tenantId)?.enabled !== false;
        return buildConnections(
          first.filter(takesPart).map((r) => leg(r, q.originCityId, hub.cityId)),
          second.filter(takesPart).map((r) => leg(r, hub.cityId, q.destCityId)),
          layover,
          (onward) => layoverWindow(requested, rules.get(onward.tenantId) ?? null),
        ).map((j) => ({ ...j, hubCity: hub }));
      }),
    );

    return perHub
      .flat()
      .sort(
        (a, b) => a.totalDurationMin - b.totalDurationMin || a.totalPriceMinor - b.totalPriceMinor,
      );
  }
}
