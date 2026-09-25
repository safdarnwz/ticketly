import { describe, expect, it } from 'vitest';

import { minuteOfDay, type StopId } from '@kernel';

import { RoutePath, type RouteStopInput } from '../domain/route-path';

const A = 'a' as StopId;
const B = 'b' as StopId;
const C = 'c' as StopId;
const D = 'd' as StopId;

/** Hyderabad → Vijayawada → Guntur → Chennai style route. */
function fourStopRoute(): RouteStopInput[] {
  return [
    { stopId: A, sequence: 0, distanceFromOriginM: 0, departOffsetMin: 0 },
    { stopId: B, sequence: 1, distanceFromOriginM: 275_000, departOffsetMin: 240, dwellMin: 10 },
    { stopId: C, sequence: 2, distanceFromOriginM: 305_000, departOffsetMin: 285, dwellMin: 5 },
    { stopId: D, sequence: 3, distanceFromOriginM: 700_000, departOffsetMin: 720 },
  ];
}

describe('RoutePath — happy path', () => {
  it('computes totals and enumerates all 6 segments for 4 stops', () => {
    const path = RoutePath.create(minuteOfDay('20:30'), fourStopRoute());
    expect(path.totalDistanceM).toBe(700_000);
    expect(path.totalDurationMin).toBe(720); // 12h
    const segments = path.segments();
    expect(segments).toHaveLength(6); // C(4,2) = 6
    const ad = segments.find((s) => s.fromStopId === A && s.toStopId === D)!;
    expect(ad.distanceM).toBe(700_000);
    expect(ad.durationMin).toBe(720);
    const bc = segments.find((s) => s.fromStopId === B && s.toStopId === C)!;
    expect(bc.distanceM).toBe(30_000);
  });

  it('derives overnight arrival with a day offset', () => {
    // Start 20:30, D departs at +720min = 08:30 next day.
    const path = RoutePath.create(minuteOfDay('20:30'), fourStopRoute());
    const d = path.stops[3];
    expect(d.departDayOffset).toBe(1);
    expect(d.arrivalDayOffset).toBe(1);
  });

  it('computes arrival = depart - dwell at intermediate stops', () => {
    const path = RoutePath.create(minuteOfDay('20:30'), fourStopRoute());
    const b = path.stops[1]; // departs +240 (00:30+1d), dwell 10 → arrives +230
    expect(b.departDayOffset).toBe(1);
    // depart 00:30, arrival 10 min earlier = 00:20
    expect(b.arrivalMinute).toBe(minuteOfDay('00:20'));
  });

  it('origin cannot be alighted, final cannot be boarded', () => {
    const path = RoutePath.create(minuteOfDay('06:00'), fourStopRoute());
    expect(path.stops[0].canAlight).toBe(false);
    expect(path.stops[0].canBoard).toBe(true);
    expect(path.stops[3].canBoard).toBe(false);
    expect(path.stops[3].canAlight).toBe(true);
  });

  it('resolves a valid segment index and rejects a reversed one', () => {
    const path = RoutePath.create(minuteOfDay('06:00'), fourStopRoute());
    expect(path.segmentIndexOf(A, C)).toEqual({ from: 0, to: 2 });
    expect(path.segmentIndexOf(C, A)).toBeNull();
  });
});

describe('RoutePath — negative & edge cases', () => {
  it('rejects a route with fewer than 2 stops', () => {
    expect(() =>
      RoutePath.create(minuteOfDay('06:00'), [
        { stopId: A, sequence: 0, distanceFromOriginM: 0, departOffsetMin: 0 },
      ]),
    ).toThrow(/at least 2 stops/);
  });

  it('rejects gapped or non-zero-based sequences', () => {
    const stops = fourStopRoute();
    stops[2].sequence = 5;
    expect(() => RoutePath.create(minuteOfDay('06:00'), stops)).toThrow(/no gaps/);
  });

  it('rejects a non-zero origin departure offset', () => {
    const stops = fourStopRoute();
    stops[0].departOffsetMin = 15;
    expect(() => RoutePath.create(minuteOfDay('06:00'), stops)).toThrow(
      /origin stop must depart at offset 0/,
    );
  });

  it('rejects distance going backwards', () => {
    const stops = fourStopRoute();
    stops[2].distanceFromOriginM = 100_000; // less than stop B
    expect(() => RoutePath.create(minuteOfDay('06:00'), stops)).toThrow(/Distance decreases/);
  });

  it('rejects time not advancing between stops', () => {
    const stops = fourStopRoute();
    stops[2].departOffsetMin = 240; // same as B
    expect(() => RoutePath.create(minuteOfDay('06:00'), stops)).toThrow(/does not advance/);
  });

  it('excludes board-only / alight-only stops from invalid segments', () => {
    const stops = fourStopRoute();
    stops[1].canAlight = false; // B is board-only (pickup point)
    stops[2].canBoard = false; // C is alight-only (drop point)
    const path = RoutePath.create(minuteOfDay('06:00'), stops);
    const segs = path.segments();
    // A->B invalid (B no alight); B->C invalid (C ok alight but B boards -> B->C valid actually)
    expect(segs.find((s) => s.fromStopId === A && s.toStopId === B)).toBeUndefined();
    expect(segs.find((s) => s.fromStopId === C && s.toStopId === D)).toBeUndefined(); // C no board
    expect(segs.find((s) => s.fromStopId === A && s.toStopId === C)).toBeDefined();
  });

  it('edge: a 2-stop route yields exactly 1 segment', () => {
    const path = RoutePath.create(minuteOfDay('06:00'), [
      { stopId: A, sequence: 0, distanceFromOriginM: 0, departOffsetMin: 0 },
      { stopId: B, sequence: 1, distanceFromOriginM: 500_000, departOffsetMin: 600 },
    ]);
    expect(path.segments()).toHaveLength(1);
  });

  it('rejects negative dwell time', () => {
    const stops = fourStopRoute();
    stops[1].dwellMin = -5;
    expect(() => RoutePath.create(minuteOfDay('06:00'), stops)).toThrow(/Negative dwell/);
  });
});

describe('RoutePath.instantAt — a stop’s own time on a trip', () => {
  const path = RoutePath.create(minuteOfDay('20:30'), fourStopRoute());
  const leaves = new Date('2026-10-01T15:00:00Z'); // 20:30 IST

  it('origin departs when the trip does', () => {
    expect(path.instantAt(0, leaves, 'depart')?.toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });
  it('a mid-route stop: arrival is before its departure by the dwell', () => {
    expect(path.instantAt(1, leaves, 'depart')?.toISOString()).toBe('2026-10-01T19:00:00.000Z');
    expect(path.instantAt(1, leaves, 'arrive')?.toISOString()).toBe('2026-10-01T18:50:00.000Z');
  });
  it('the last stop the next morning', () => {
    expect(path.instantAt(3, leaves, 'arrive')?.toISOString()).toBe('2026-10-02T03:00:00.000Z');
  });
  it('an unknown stop has no time', () => {
    expect(path.instantAt(9, leaves, 'depart')).toBeNull();
  });
});
