import { describe, it, expect } from 'vitest';

import { filterAndSort, matchesFilter, type FilterableTrip } from '../domain/result-filter';

const mk = (o: Partial<FilterableTrip>): FilterableTrip => ({
  departsAt: '2026-09-01T09:00:00.000Z',
  arrivesAt: '2026-09-01T15:00:00.000Z',
  durationMin: 360,
  fromPriceMinor: 50000,
  availableSeats: 10,
  ...o,
});

describe('matchesFilter', () => {
  it('happy: passes a trip meeting every constraint', () => {
    const t = mk({
      fromPriceMinor: 40000,
      operatorRating: 4.5,
      seatTypes: ['sleeper'],
      amenities: ['wifi', 'charging'],
    });
    expect(
      matchesFilter(t, {
        minPriceMinor: 30000,
        maxPriceMinor: 50000,
        minRating: 4,
        seatTypes: ['sleeper'],
        amenities: ['wifi'],
        minSeats: 2,
      }),
    ).toBe(true);
  });

  it('positive: price band filters correctly on both edges', () => {
    expect(matchesFilter(mk({ fromPriceMinor: 30000 }), { minPriceMinor: 30000 })).toBe(true); // inclusive lower
    expect(matchesFilter(mk({ fromPriceMinor: 30000 }), { maxPriceMinor: 30000 })).toBe(true); // inclusive upper
    expect(matchesFilter(mk({ fromPriceMinor: 29999 }), { minPriceMinor: 30000 })).toBe(false);
  });

  it('positive: departAfter/departBefore use wall-clock HH:mm', () => {
    const evening = mk({ departsAt: '2026-09-01T18:30:00.000Z' });
    expect(matchesFilter(evening, { departAfter: '18:00' })).toBe(true);
    expect(matchesFilter(evening, { departBefore: '18:00' })).toBe(false);
  });

  it('negative: amenities require ALL, seatTypes require ANY', () => {
    const t = mk({ seatTypes: ['seater'], amenities: ['wifi'] });
    expect(matchesFilter(t, { seatTypes: ['sleeper', 'seater'] })).toBe(true); // any-match
    expect(matchesFilter(t, { amenities: ['wifi', 'charging'] })).toBe(false); // all-match fails
  });

  it('edge: missing rating treated as 0 against a minRating', () => {
    expect(matchesFilter(mk({ operatorRating: undefined }), { minRating: 3 })).toBe(false);
  });

  it('negative: an invalid HH:mm throws', () => {
    expect(() => matchesFilter(mk({}), { departAfter: '25:00' })).toThrow();
    expect(() => matchesFilter(mk({}), { departBefore: '9am' })).toThrow();
  });
});

describe('filterAndSort', () => {
  const trips = [
    mk({
      tripId: 'a',
      departsAt: '2026-09-01T12:00:00Z',
      fromPriceMinor: 60000,
      durationMin: 300,
      operatorRating: 3,
    } as never),
    mk({
      tripId: 'b',
      departsAt: '2026-09-01T06:00:00Z',
      fromPriceMinor: 40000,
      durationMin: 420,
      operatorRating: 5,
    } as never),
    mk({
      tripId: 'c',
      departsAt: '2026-09-01T09:00:00Z',
      fromPriceMinor: 40000,
      durationMin: 360,
      operatorRating: 4,
    } as never),
  ];

  it('happy: sorts by price ascending, stable on ties (input order preserved)', () => {
    const r = filterAndSort(trips, {}, 'price', 'asc') as (FilterableTrip & { tripId: string })[];
    expect(r.map((t) => t.tripId)).toEqual(['b', 'c', 'a']); // b & c both 40000, b before c (input order)
  });

  it('positive: rating sort defaults to descending (best first)', () => {
    const r = filterAndSort(trips, {}, 'rating') as (FilterableTrip & { tripId: string })[];
    expect(r.map((t) => t.tripId)).toEqual(['b', 'c', 'a']);
  });

  it('positive: departure sort ascending', () => {
    const r = filterAndSort(trips, {}, 'departure') as (FilterableTrip & { tripId: string })[];
    expect(r.map((t) => t.tripId)).toEqual(['b', 'c', 'a']);
  });

  it('edge: filter then sort — empty result when nothing matches', () => {
    expect(filterAndSort(trips, { minPriceMinor: 999999 })).toHaveLength(0);
  });
});
