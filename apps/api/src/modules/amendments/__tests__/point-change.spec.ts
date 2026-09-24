import { describe, expect, it } from 'vitest';

import { planPointChange, sameFare } from '../domain/point-change';

// Route: A(0) → B(30 min) → C(120) → D(300). D is drop-only, A board-only.
const stops = [
  { stopId: 'A', sequence: 1, departOffsetMin: 0, canBoard: true, canAlight: false },
  { stopId: 'B', sequence: 2, departOffsetMin: 30, canBoard: true, canAlight: true },
  { stopId: 'C', sequence: 3, departOffsetMin: 120, canBoard: true, canAlight: true },
  { stopId: 'D', sequence: 4, departOffsetMin: 300, canBoard: false, canAlight: true },
];
const DEP = new Date('2026-10-01T20:00:00Z');
const base = { stops, current: { fromSeq: 1, toSeq: 4 }, tripDepartsAt: DEP, now: new Date('2026-10-01T10:00:00Z') };

describe('planPointChange', () => {
  it('boarding moves later on the route', () => {
    expect(planPointChange({ ...base, newFromStopId: 'B' })).toEqual({ fromSeq: 2, toSeq: 4, fromStopId: 'B', toStopId: 'D' });
  });
  it('dropping point moves earlier', () => {
    expect(planPointChange({ ...base, newToStopId: 'C' }).toSeq).toBe(3);
  });
  it('refuses stops where boarding / alighting is not allowed', () => {
    expect(() => planPointChange({ ...base, newFromStopId: 'D' })).toThrow(/Boarding is not allowed/);
    expect(() => planPointChange({ ...base, current: { fromSeq: 2, toSeq: 4 }, newToStopId: 'A' })).toThrow(/Alighting is not allowed/);
  });
  it('refuses unknown stops, reversed direction and no-op', () => {
    expect(() => planPointChange({ ...base, newFromStopId: 'Z' })).toThrow(/not on this route/);
    expect(() => planPointChange({ ...base, newFromStopId: 'C', newToStopId: 'B' })).toThrow(/must come before/);
    expect(() => planPointChange({ ...base, newFromStopId: 'A' })).toThrow(/already your/);
  });
  it('cut-off uses the EARLIER boarding stop', () => {
    // Moving from B (20:30) to A (20:00): A is earlier → at 19:30 the 60-minute cut-off has passed.
    expect(() => planPointChange({ ...base, current: { fromSeq: 2, toSeq: 4 }, newFromStopId: 'A', now: new Date('2026-10-01T19:30:00Z') })).toThrow(/60 minutes/);
    // Moving from A to C at 19:30: A (20:00) is the earlier one and is only 30 min away → refused.
    expect(() => planPointChange({ ...base, newFromStopId: 'C', now: new Date('2026-10-01T19:30:00Z') })).toThrow(/60 minutes/);
    expect(planPointChange({ ...base, newFromStopId: 'C', now: new Date('2026-10-01T18:59:00Z') }).fromSeq).toBe(3);
  });
  it('stops missing from the route are reported', () => {
    expect(() => planPointChange({ ...base, current: { fromSeq: 9, toSeq: 4 }, newFromStopId: 'B' })).toThrow(/no longer on this route/);
  });
});

describe('sameFare', () => {
  it('only an identical fare for every seat type counts', () => {
    expect(sameFare([50000, 70000], [50000, 70000])).toBe(true);
    expect(sameFare([50000], [45000])).toBe(false);
    expect(sameFare([50000], [null])).toBe(false);
    expect(sameFare([50000], [])).toBe(false);
  });
});
