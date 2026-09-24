import { describe, expect, it } from 'vitest';

import { bearingDegrees, etaSeconds, haversineMeters, isWithin, nextStopEta } from '../domain/geo';

// Known landmarks for distance sanity checks.
const HYD = { lat: 17.3850, lng: 78.4867 };
const BLR = { lat: 12.9716, lng: 77.5946 };

describe('haversineMeters', () => {
  it('computes a known intercity distance within tolerance', () => {
    const d = haversineMeters(HYD, BLR);
    // Hyderabad→Bengaluru great-circle ≈ 500 km.
    expect(d).toBeGreaterThan(490_000);
    expect(d).toBeLessThan(520_000);
  });

  it('is zero for identical points', () => {
    expect(haversineMeters(HYD, HYD)).toBe(0);
  });

  it('is symmetric', () => {
    expect(Math.round(haversineMeters(HYD, BLR))).toBe(Math.round(haversineMeters(BLR, HYD)));
  });

  it('edge: ~111m for 0.001° of latitude', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 });
    expect(d).toBeGreaterThan(108);
    expect(d).toBeLessThan(114);
  });
});

describe('isWithin (geofence)', () => {
  it('detects a point inside the radius', () => {
    const near = { lat: HYD.lat + 0.0005, lng: HYD.lng }; // ~55m away
    expect(isWithin(near, HYD, 100)).toBe(true);
  });

  it('rejects a point outside the radius', () => {
    const far = { lat: HYD.lat + 0.01, lng: HYD.lng }; // ~1.1km away
    expect(isWithin(far, HYD, 100)).toBe(false);
  });

  it('edge: exactly on the boundary is within (<=)', () => {
    const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 });
    expect(isWithin({ lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }, d)).toBe(true);
  });
});

describe('etaSeconds', () => {
  it('computes time at a given speed', () => {
    // 30km at 60km/h = 30 min = 1800s
    expect(etaSeconds(30_000, 60)).toBe(1800);
  });

  it('uses the floor speed for a stopped bus (no infinite ETA)', () => {
    const eta = etaSeconds(15_000, 0, 15); // floor 15km/h
    expect(eta).toBe(3600); // 15km at 15km/h = 1h
  });

  it('returns 0 when already arrived', () => {
    expect(etaSeconds(0, 60)).toBe(0);
    expect(etaSeconds(-5, 60)).toBe(0);
  });
});

describe('bearingDegrees', () => {
  it('points east for a due-east move', () => {
    const b = bearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(Math.round(b)).toBe(90);
  });

  it('points north for a due-north move', () => {
    const b = bearingDegrees({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(Math.round(b)).toBe(0);
  });
});

describe('nextStopEta', () => {
  const stops = [
    { stopId: 'A', distanceFromOriginM: 0 },
    { stopId: 'B', distanceFromOriginM: 100_000 },
    { stopId: 'C', distanceFromOriginM: 250_000 },
  ];

  it('finds the next stop ahead and its ETA', () => {
    const r = nextStopEta(stops, 60_000, 60); // 40km to B
    expect(r.nextStopId).toBe('B');
    expect(r.remainingM).toBe(40_000);
    expect(r.etaSeconds).toBe(2400); // 40km at 60km/h
  });

  it('advances to C once past B', () => {
    expect(nextStopEta(stops, 120_000, 60).nextStopId).toBe('C');
  });

  it('edge: returns null past the final stop', () => {
    const r = nextStopEta(stops, 300_000, 60);
    expect(r.nextStopId).toBeNull();
    expect(r.etaSeconds).toBe(0);
  });
});
