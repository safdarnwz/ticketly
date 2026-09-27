import { describe, expect, it } from 'vitest';

import {
  neighbourProblems,
  neighboursOf,
  reservedSeats,
  type PlacedSeat,
} from '../domain/seat-neighbours';

// A 2+2 seater row (aisle at column 2) and a 2+1 sleeper row on the upper deck
// (single berth at column 0, double pair at 2-3), plus a horizontal back berth.
const s = (
  seatNumber: string,
  deck: number,
  row: number,
  column: number,
  rowSpan = 1,
  colSpan = 1,
): PlacedSeat => ({
  seatNumber,
  deck,
  row,
  column,
  rowSpan,
  colSpan,
});
const SEATS = [
  s('1', 0, 0, 0),
  s('2', 0, 0, 1),
  s('3', 0, 0, 3),
  s('4', 0, 0, 4),
  s('5', 0, 1, 0), // behind seat 1
  s('U1', 1, 0, 0, 2),
  s('U2', 1, 0, 2, 2),
  s('U3', 1, 0, 3, 2),
  s('UB', 1, 4, 0, 1, 2),
  s('UB2', 1, 4, 2, 1, 2), // horizontal berths side by side
];

describe('seat neighbours', () => {
  it('pairs seats that touch side by side, never across the aisle or front to back', () => {
    const n = (x: string) =>
      neighboursOf(
        SEATS.find((q) => q.seatNumber === x)!,
        SEATS,
      ).map((q) => q.seatNumber);
    expect(n('1')).toEqual(['2']);
    expect(n('2')).toEqual(['1']); // seat 3 is across the aisle
    expect(n('5')).toEqual([]);
    expect(n('U2')).toEqual(['U3']); // the single berth U1 has an aisle beside it
    expect(n('UB')).toEqual(['UB2']);
  });

  it("keeps the seat beside a woman for women; 'both' also keeps a man's neighbour for men", () => {
    const taken = new Map([
      ['1', 'female' as const],
      ['U2', 'male' as const],
    ]);
    expect([...reservedSeats('off', SEATS, taken)]).toEqual([]);
    expect([...reservedSeats('women', SEATS, taken)]).toEqual([['2', 'female']]);
    expect([...reservedSeats('both', SEATS, taken)]).toEqual([
      ['2', 'female'],
      ['U3', 'male'],
    ]);
  });

  it('a seat between a woman and a man is kept for a woman', () => {
    const row = [s('A', 0, 0, 0), s('B', 0, 0, 1), s('C', 0, 0, 2)];
    const taken = new Map([
      ['A', 'female' as const],
      ['C', 'male' as const],
    ]);
    expect(reservedSeats('both', row, taken).get('B')).toBe('female');
  });

  it('names the passengers who break the rule; a couple booking the pair together is fine', () => {
    const taken = new Map([['1', 'female' as const]]);
    expect(
      neighbourProblems('women', SEATS, taken, [
        { seatNumber: '2', fullName: 'Ravi', gender: 'male' },
      ])[0],
    ).toMatch(/Ravi \(seat 2\).*kept for women/);
    expect(
      neighbourProblems('women', SEATS, taken, [{ seatNumber: '2', gender: null }])[0],
    ).toMatch(/gender/);
    expect(
      neighbourProblems('women', SEATS, taken, [{ seatNumber: '2', gender: 'female' }]),
    ).toEqual([]);
    // Nobody on 3/4 yet: a man and a woman take the pair in one booking.
    expect(
      neighbourProblems('both', SEATS, new Map(), [
        { seatNumber: '3', gender: 'male' },
        { seatNumber: '4', gender: 'female' },
      ]),
    ).toEqual([]);
  });
});
