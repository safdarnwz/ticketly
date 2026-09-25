import { describe, expect, it } from 'vitest';

import type { CityId, LocalDate } from '@kernel';

import { JourneySearchService } from '../application/services/journey-search.service';
import type { SearchResult } from '../application/services/search.service';

const A = 'city-a' as CityId;
const H = 'city-h' as CityId;
const H2 = 'city-h2' as CityId;
const B = 'city-b' as CityId;
const D1 = '2026-10-01' as LocalDate;

function result(tripId: string, departsAt: string, arrivesAt: string, price = 50000): SearchResult {
  return {
    tripId: tripId as never,
    routeId: 'r' as never,
    tenantId: 't' as never,
    operatorName: 'Op',
    boardingStop: { id: 's1' as never, name: 'Start' },
    droppingStop: { id: 's2' as never, name: 'End' },
    departsAt,
    arrivesAt,
    durationMin: Math.round((Date.parse(arrivesAt) - Date.parse(departsAt)) / 60000),
    availableSeats: 10,
    fromPriceMinor: price,
    currency: 'INR',
    amenities: [{ id: 'a1', code: 'wifi', name: 'WiFi', icon: null } as never],
    seatTypes: ['seater'],
    rating: null,
    ratingCount: 0,
  };
}

/** Fake core search keyed by "origin>dest@date". */
function service(byKey: Record<string, SearchResult[]>, hubs = [{ cityId: H, name: 'Hub' }]) {
  const search = {
    search: async (i: { originCityId: string; destCityId: string; journeyDate: string }) =>
      byKey[`${i.originCityId}>${i.destCityId}@${i.journeyDate}`] ?? [],
  };
  const hubRepo = { hubsBetween: async () => hubs };
  return new JourneySearchService(
    search as never,
    hubRepo as never,
    {
      domain: { timezone: 'Asia/Kolkata' },
    } as never,
  );
}

describe('JourneySearchService.connecting', () => {
  it('pairs legs through a discovered hub, including an overnight second leg', async () => {
    const svc = service({
      [`${A}>${H}@${D1}`]: [result('leg1', '2026-10-01T14:00:00Z', '2026-10-01T21:00:00Z')],
      [`${H}>${B}@2026-10-02`]: [result('leg2', '2026-10-02T01:00:00Z', '2026-10-02T06:00:00Z')],
    });
    const journeys = await svc.connecting({ originCityId: A, destCityId: B, journeyDate: D1 });
    expect(journeys).toHaveLength(1);
    expect(journeys[0].layoverMin).toBe(240);
    expect(journeys[0].hubCity.name).toBe('Hub');
    // each leg is a full, quotable search result
    expect(journeys[0].legs[0].boardingStop.id).toBe('s1');
    expect(journeys[0].legs[1].tripId).toBe('leg2');
  });

  it('respects the layover window (default at least 2 h)', async () => {
    const svc = service({
      [`${A}>${H}@${D1}`]: [result('leg1', '2026-10-01T06:00:00Z', '2026-10-01T10:00:00Z')],
      [`${H}>${B}@${D1}`]: [result('tooSoon', '2026-10-01T11:00:00Z', '2026-10-01T15:00:00Z')],
    });
    expect(await svc.connecting({ originCityId: A, destCityId: B, journeyDate: D1 })).toEqual([]);
    expect(
      await svc.connecting({ originCityId: A, destCityId: B, journeyDate: D1, minLayoverMin: 30 }),
    ).toHaveLength(1);
  });

  it('only uses the requested hub when one is given', async () => {
    const svc = service(
      {
        [`${A}>${H}@${D1}`]: [result('viaH', '2026-10-01T06:00:00Z', '2026-10-01T10:00:00Z')],
        [`${H}>${B}@${D1}`]: [result('hB', '2026-10-01T13:00:00Z', '2026-10-01T15:00:00Z')],
        [`${A}>${H2}@${D1}`]: [result('viaH2', '2026-10-01T06:00:00Z', '2026-10-01T09:00:00Z')],
        [`${H2}>${B}@${D1}`]: [result('h2B', '2026-10-01T12:00:00Z', '2026-10-01T14:00:00Z')],
      },
      [
        { cityId: H, name: 'Hub' },
        { cityId: H2, name: 'Hub 2' },
      ],
    );
    const all = await svc.connecting({ originCityId: A, destCityId: B, journeyDate: D1 });
    expect(all.map((j) => j.hubCity.name).sort()).toEqual(['Hub', 'Hub 2']);
    const onlyH2 = await svc.connecting({
      originCityId: A,
      destCityId: B,
      journeyDate: D1,
      hubCityId: H2,
    });
    expect(onlyH2.map((j) => j.hubCity.name)).toEqual(['Hub 2']);
  });
});

describe('JourneySearchService.trips', () => {
  it('filters/sorts on amenity codes but returns full amenity objects', async () => {
    const cheap = result('cheap', '2026-10-01T08:00:00Z', '2026-10-01T12:00:00Z', 30000);
    const dear = result('dear', '2026-10-01T06:00:00Z', '2026-10-01T10:00:00Z', 90000);
    const svc = service({ [`${A}>${B}@${D1}`]: [dear, cheap] });
    const out = await svc.trips({
      originCityId: A,
      destCityId: B,
      journeyDate: D1,
      filter: { amenities: ['wifi'] },
      sort: 'price',
    });
    expect(out.map((r) => r.tripId)).toEqual(['cheap', 'dear']);
    expect(out[0].amenities[0]).toMatchObject({ code: 'wifi', name: 'WiFi' });
  });
});

describe('JourneySearchService.trips — filters a traveller uses', () => {
  const at = (id: string, depUtc: string, extra: Partial<SearchResult> = {}) => ({
    ...result(id, depUtc, new Date(Date.parse(depUtc) + 6 * 3_600_000).toISOString()),
    ...extra,
  });
  const run = (rows: SearchResult[], q: Partial<Parameters<JourneySearchService['trips']>[0]>) =>
    service({ [`${A}>${B}@${D1}`]: rows })
      .trips({ originCityId: A, destCityId: B, journeyDate: D1, ...q })
      .then((r) => r.map((t) => t.tripId));

  it('reads "leaving after 18:00" in the operator timezone (IST), not UTC', async () => {
    // 12:00Z = 17:30 IST, 13:00Z = 18:30 IST
    const rows = [at('early', '2026-10-01T12:00:00Z'), at('evening', '2026-10-01T13:00:00Z')];
    expect(await run(rows, { filter: { departAfter: '18:00' } })).toEqual(['evening']);
    expect(await run(rows, { filter: { departBefore: '18:00' } })).toEqual(['early']);
  });

  it('keeps only buses rated at least the minimum; unrated ones are left out', async () => {
    const rows = [
      at('good', '2026-10-01T08:00:00Z', { rating: 4.4, ratingCount: 12 }),
      at('poor', '2026-10-01T09:00:00Z', { rating: 2.9, ratingCount: 5 }),
      at('new', '2026-10-01T10:00:00Z'),
    ];
    expect(await run(rows, { filter: { minRating: 4 } })).toEqual(['good']);
    expect(await run(rows, { sort: 'rating' })).toEqual(['good', 'poor', 'new']);
  });

  it('filters by seat type (any of the chosen types)', async () => {
    const rows = [
      at('seater', '2026-10-01T08:00:00Z', { seatTypes: ['seater'] }),
      at('sleeper', '2026-10-01T09:00:00Z', { seatTypes: ['sleeper', 'semi_sleeper'] }),
    ];
    expect(await run(rows, { filter: { seatTypes: ['sleeper'] } })).toEqual(['sleeper']);
    expect(await run(rows, { filter: { seatTypes: ['seater', 'sleeper'] } })).toEqual([
      'seater',
      'sleeper',
    ]);
  });

  it('sorts by departure instant, so a bus after midnight comes last', async () => {
    // 18:00Z = 23:30 IST, 19:00Z = 00:30 IST next day
    const rows = [at('late', '2026-10-01T19:00:00Z'), at('night', '2026-10-01T18:00:00Z')];
    expect(await run(rows, { sort: 'departure' })).toEqual(['night', 'late']);
  });
});
