import { describe, it, expect } from 'vitest';

import { buildConnections, type JourneyLeg } from '../domain/connecting-journey';

const leg = (o: Partial<JourneyLeg>): JourneyLeg => ({
  tripId: 't', fromHub: 'A', toHub: 'H',
  departsAt: '2026-09-01T06:00:00Z', arrivesAt: '2026-09-01T10:00:00Z',
  priceMinor: 30000, availableSeats: 10, currency: 'INR', ...o,
});

describe('buildConnections', () => {
  const opts = { minLayoverMin: 30, maxLayoverMin: 240 };

  it('happy: pairs A→H with H→B within the layover window', () => {
    const first = [leg({ tripId: 'f1', fromHub: 'A', toHub: 'H', arrivesAt: '2026-09-01T10:00:00Z' })];
    const second = [leg({ tripId: 's1', fromHub: 'H', toHub: 'B', departsAt: '2026-09-01T11:00:00Z', arrivesAt: '2026-09-01T14:00:00Z', priceMinor: 25000 })];
    const r = buildConnections(first, second, opts);
    expect(r).toHaveLength(1);
    expect(r[0].layoverMin).toBe(60);
    expect(r[0].totalPriceMinor).toBe(55000);
    expect(r[0].totalDurationMin).toBe(480); // 06:00 → 14:00 incl layover
    expect(r[0].hub).toBe('H');
    expect(r[0].minSeats).toBe(10);
  });

  it('negative: rejects a layover below the minimum', () => {
    const first = [leg({ toHub: 'H', arrivesAt: '2026-09-01T10:00:00Z' })];
    const second = [leg({ fromHub: 'H', toHub: 'B', departsAt: '2026-09-01T10:15:00Z' })]; // 15 min < 30
    expect(buildConnections(first, second, opts)).toHaveLength(0);
  });

  it('negative: rejects a layover above the maximum', () => {
    const first = [leg({ toHub: 'H', arrivesAt: '2026-09-01T10:00:00Z' })];
    const second = [leg({ fromHub: 'H', toHub: 'B', departsAt: '2026-09-01T18:00:00Z' })]; // 8h > 4h
    expect(buildConnections(first, second, opts)).toHaveLength(0);
  });

  it('negative: never connects legs meeting at different hubs', () => {
    const first = [leg({ toHub: 'H1' })];
    const second = [leg({ fromHub: 'H2', toHub: 'B', departsAt: '2026-09-01T11:00:00Z' })];
    expect(buildConnections(first, second, opts)).toHaveLength(0);
  });

  it('edge: drops a connection that loops back to the origin', () => {
    const first = [leg({ fromHub: 'A', toHub: 'H', arrivesAt: '2026-09-01T10:00:00Z' })];
    const second = [leg({ fromHub: 'H', toHub: 'A', departsAt: '2026-09-01T11:00:00Z' })]; // back to A
    expect(buildConnections(first, second, opts)).toHaveLength(0);
  });

  it('positive: sorts by total duration, then price; bottleneck seats reported', () => {
    const first = [
      leg({ tripId: 'f-slow', toHub: 'H', arrivesAt: '2026-09-01T10:00:00Z', availableSeats: 3 }),
    ];
    const second = [
      leg({ tripId: 's-fast', fromHub: 'H', toHub: 'B', departsAt: '2026-09-01T10:45:00Z', arrivesAt: '2026-09-01T12:00:00Z', availableSeats: 8 }),
      leg({ tripId: 's-slow', fromHub: 'H', toHub: 'B', departsAt: '2026-09-01T10:45:00Z', arrivesAt: '2026-09-01T15:00:00Z', availableSeats: 8 }),
    ];
    const r = buildConnections(first, second, { minLayoverMin: 30, maxLayoverMin: 120 });
    expect(r).toHaveLength(2);
    expect(r[0].legs[1].tripId).toBe('s-fast'); // shorter total first
    expect(r[0].minSeats).toBe(3); // bottleneck is first leg
  });

  it('negative: an inverted layover window throws', () => {
    expect(() => buildConnections([], [], { minLayoverMin: 200, maxLayoverMin: 30 })).toThrow();
  });
});
