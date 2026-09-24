import { describe, expect, it } from 'vitest';

import { planVehicleSwap, windowsOverlap, type CurrentSeat, type LayoutSeat } from '../domain/vehicle-swap-plan';

const cur = (n: string, type: string, occupied = 0n, blocked = 0n, ladiesOnly = false): CurrentSeat => ({ seatNumber: n, seatType: type, occupied, blocked, ladiesOnly });
const lay = (n: string, type: string, bookable = true, ladiesOnly = false): LayoutSeat => ({ number: n, type, bookable, ladiesOnly });

describe('planVehicleSwap', () => {
  it('identical layout: every in-use seat stays, bitmaps carried', () => {
    const p = planVehicleSwap([cur('1', 'seater', 3n), cur('2', 'seater')], [lay('1', 'seater'), lay('2', 'seater')]);
    expect(p.kept).toEqual(['1']);
    expect(p.moves).toEqual([]);
    expect(p.newSeats.find((s) => s.seatNumber === '1')!.occupied).toBe(3n);
  });
  it('missing seat moves to the first free seat of the SAME type', () => {
    const p = planVehicleSwap([cur('L9', 'sleeper', 1n)], [lay('L1', 'sleeper'), lay('S1', 'seater')]);
    expect(p.moves).toEqual([{ from: 'L9', to: 'L1', seatType: 'sleeper' }]);
    expect(p.blockers).toEqual([]);
  });
  it('a kept seat is never taken by a moving seat', () => {
    const p = planVehicleSwap([cur('1', 'seater', 1n), cur('9', 'seater', 1n)], [lay('1', 'seater'), lay('2', 'seater')]);
    expect(p.kept).toEqual(['1']);
    expect(p.moves).toEqual([{ from: '9', to: '2', seatType: 'seater' }]);
  });
  it('type changed at the same number → moved, never downgraded in place', () => {
    const p = planVehicleSwap([cur('5', 'sleeper', 1n)], [lay('5', 'seater'), lay('6', 'sleeper')]);
    expect(p.moves).toEqual([{ from: '5', to: '6', seatType: 'sleeper' }]);
  });
  it('blocked and quota seats move too (blocked bits carried)', () => {
    const p = planVehicleSwap([cur('9', 'seater', 0n, -1n)], [lay('1', 'seater')]);
    expect(p.moves).toEqual([{ from: '9', to: '1', seatType: 'seater' }]);
    expect(p.newSeats[0].blocked).toBe(-1n);
  });
  it('never moves anyone INTO a ladies-only or non-bookable seat', () => {
    const p = planVehicleSwap([cur('9', 'seater', 1n)], [lay('1', 'seater', true, true), lay('2', 'seater', false)]);
    expect(p.blockers).toEqual(['9 (seater)']);
  });
  it('not enough seats of a type → blockers listed (swap must be refused)', () => {
    const p = planVehicleSwap([cur('L1', 'sleeper', 1n), cur('L2', 'sleeper', 1n)], [lay('L1', 'sleeper'), lay('S1', 'seater')]);
    expect(p.kept).toEqual(['L1']);
    expect(p.blockers).toEqual(['L2 (sleeper)']);
  });
  it('free seats are not "in use" and are simply rebuilt from the new layout', () => {
    const p = planVehicleSwap([cur('1', 'seater')], [lay('A', 'seater'), lay('B', 'seater')]);
    expect(p.moves).toEqual([]);
    expect(p.newSeats.map((s) => s.seatNumber)).toEqual(['A', 'B']);
  });
});

describe('windowsOverlap (bus double-assignment guard)', () => {
  const t = (d: string, a: string) => ({ departsAt: new Date(d), arrivesAt: new Date(a) });
  it('overlapping trips conflict; back-to-back needs the turnaround buffer', () => {
    expect(windowsOverlap(t('2026-10-01T20:00Z', '2026-10-02T06:00Z'), t('2026-10-02T05:00Z', '2026-10-02T12:00Z'))).toBe(true);
    expect(windowsOverlap(t('2026-10-01T20:00Z', '2026-10-02T06:00Z'), t('2026-10-02T06:15Z', '2026-10-02T12:00Z'))).toBe(true);
    expect(windowsOverlap(t('2026-10-01T20:00Z', '2026-10-02T06:00Z'), t('2026-10-02T07:00Z', '2026-10-02T12:00Z'))).toBe(false);
  });
});
