import { describe, expect, it } from 'vitest';

import { planSeatChange } from '../domain/seat-change';

const cur = (...s: [string, number][]) =>
  s.map(([seatNumber, fareMinor]) => ({ seatNumber, fareMinor }));

describe('planSeatChange', () => {
  it('overlapping change: the passenger already on a new seat stays; the other moves (1A,1B → 1B,1C)', () => {
    const p = planSeatChange(cur(['1A', 800], ['1B', 900]), ['1B', '1C']);
    expect(p.kept).toEqual(['1B']);
    expect(p.moves).toEqual([{ from: '1A', to: '1C', fareMinor: 800 }]);
  });
  it('fares travel with the passenger — the total is unchanged', () => {
    const p = planSeatChange(cur(['1A', 800], ['2A', 900]), ['5A', '6A']);
    expect(p.moves.reduce((s, m) => s + m.fareMinor, 0)).toBe(1700);
  });
  it('natural seat order (2 before 10), independent of input/DB order', () => {
    const p = planSeatChange(cur(['10', 500], ['2', 600]), ['21', '3']);
    expect(p.moves).toEqual([
      { from: '2', to: '3', fareMinor: 600 },
      { from: '10', to: '21', fareMinor: 500 },
    ]);
  });
  it('a full swap between the same seats is "no change"', () => {
    expect(() => planSeatChange(cur(['1A', 1], ['1B', 1]), ['1B', '1A'])).toThrow(
      /nothing to change/,
    );
  });
  it('negative: count change, duplicates, blanks', () => {
    expect(() => planSeatChange(cur(['1A', 1]), ['1A', '1B'])).toThrow(/exactly 1/);
    expect(() => planSeatChange(cur(['1A', 1], ['1B', 1]), ['2A', '2A'])).toThrow(/more than once/);
    expect(() => planSeatChange(cur(['1A', 1]), [' '])).toThrow(/blank/);
  });
});
