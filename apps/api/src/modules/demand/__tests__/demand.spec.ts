import { describe, expect, it } from 'vitest';

import { forecastOccupancy, median } from '../domain/occupancy-forecast';
import { pickToNotify, validateJoin } from '../domain/waitlist-rules';

const NOW = new Date('2026-09-23T10:00:00Z');
const DEP = new Date('2026-09-25T20:00:00Z');
const join = { seatCount: 2, availableSeats: 0, tripStatus: 'open', departsAt: DEP, waitingCount: 3, now: NOW };

describe('waitlist: validateJoin', () => {
  it('happy path when the bus is full', () => expect(() => validateJoin(join)).not.toThrow());
  it('refuses when seats ARE available (book directly instead)', () => {
    expect(() => validateJoin({ ...join, availableSeats: 2 })).toThrow(/book them directly/);
    expect(() => validateJoin({ ...join, availableSeats: 1 })).not.toThrow(); // 1 free but 2 wanted
  });
  it('negative: seat count, closed trip, too close to departure, full list', () => {
    for (const n of [0, 7, 1.5]) expect(() => validateJoin({ ...join, seatCount: n })).toThrow(/1 to 6/);
    expect(() => validateJoin({ ...join, tripStatus: 'departed' })).toThrow(/not open/);
    expect(() => validateJoin({ ...join, departsAt: new Date('2026-09-23T10:30:00Z') })).toThrow(/hour before/);
    expect(() => validateJoin({ ...join, waitingCount: 100 })).toThrow(/full/);
  });
});

describe('waitlist: pickToNotify (FIFO, never more people than seats)', () => {
  it('notifies in order until seats run out; a too-big request is skipped, not blocking', () => {
    const picked = pickToNotify([
      { id: 'a', seatCount: 1, availableForSegment: 3 },
      { id: 'b', seatCount: 3, availableForSegment: 3 }, // only 2 left after a → skipped
      { id: 'c', seatCount: 2, availableForSegment: 3 },
      { id: 'd', seatCount: 1, availableForSegment: 3 }, // none left
    ]);
    expect(picked).toEqual(['a', 'c']);
  });
  it('nothing free → nobody notified', () => {
    expect(pickToNotify([{ id: 'a', seatCount: 1, availableForSegment: 0 }])).toEqual([]);
  });
});

describe('occupancy forecast', () => {
  it('median pace: 10 sold now, comparable trips had ~50% sold by now → ~20', () => {
    const f = forecastOccupancy({ currentSold: 10, totalSeats: 40, history: [
      { soldAtSameLead: 10, finalSold: 20 }, { soldAtSameLead: 15, finalSold: 30 }, { soldAtSameLead: 5, finalSold: 10 }, { soldAtSameLead: 40, finalSold: 40 },
    ] });
    expect(f.paceShare).toBe(0.5);
    expect(f.forecastSeats).toBe(20);
    expect(f.confidence).toBe('medium');
  });
  it('capped at capacity, never below what is already sold', () => {
    expect(forecastOccupancy({ currentSold: 30, totalSeats: 40, history: [{ soldAtSameLead: 1, finalSold: 40 }] }).forecastSeats).toBe(40);
    expect(forecastOccupancy({ currentSold: 30, totalSeats: 40, history: [{ soldAtSameLead: 40, finalSold: 40 }] }).forecastSeats).toBe(30);
  });
  it('no usable history → no forecast, confidence none; zero pace falls back to median final', () => {
    expect(forecastOccupancy({ currentSold: 5, totalSeats: 40, history: [] }).forecastSeats).toBeNull();
    expect(forecastOccupancy({ currentSold: 5, totalSeats: 40, history: [{ soldAtSameLead: 0, finalSold: 0 }] }).confidence).toBe('none');
    expect(forecastOccupancy({ currentSold: 0, totalSeats: 40, history: [{ soldAtSameLead: 0, finalSold: 24 }, { soldAtSameLead: 0, finalSold: 26 }] }).forecastSeats).toBe(25);
  });
  it('median handles odd/even/empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
