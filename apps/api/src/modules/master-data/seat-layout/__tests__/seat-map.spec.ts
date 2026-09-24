import { describe, expect, it } from 'vitest';

import { SeatMap, type SeatMapProps } from '../domain/seat-map';

/** A minimal valid 2x2 seater layout. */
function validSeater(): SeatMapProps {
  return {
    decks: 1,
    rows: 2,
    columns: 3, // col 0,1 = seats, col 2 leaves an aisle example
    seats: [
      { number: 'A1', deck: 0, row: 0, column: 0, type: 'seater' },
      { number: 'A2', deck: 0, row: 0, column: 1, type: 'seater' },
      { number: 'B1', deck: 0, row: 1, column: 0, type: 'seater' },
      { number: 'B2', deck: 0, row: 1, column: 1, type: 'seater' },
    ],
  };
}

describe('SeatMap — happy path', () => {
  it('constructs a valid layout and derives an accurate summary', () => {
    const map = SeatMap.create(validSeater());
    expect(map.seatCount).toBe(4);
    expect(map.summary.totalSeats).toBe(4);
    expect(map.summary.seater).toBe(4);
    expect(map.summary.bookableSeats).toBe(4);
    expect(map.bookableSeatNumbers()).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('handles a double-decker sleeper with 1x2 berths', () => {
    const map = SeatMap.create({
      decks: 2,
      rows: 2,
      columns: 2,
      seats: [
        { number: 'L1', deck: 0, row: 0, column: 0, rowSpan: 2, type: 'sleeper' },
        { number: 'U1', deck: 1, row: 0, column: 0, rowSpan: 2, type: 'sleeper' },
        { number: 'U2', deck: 1, row: 0, column: 1, rowSpan: 2, type: 'sleeper', ladiesOnly: true },
      ],
    });
    expect(map.summary.sleeper).toBe(3);
    expect(map.summary.decks).toBe(2);
    expect(map.summary.ladiesOnly).toBe(1);
    expect(map.isLadiesOnly('U2')).toBe(true);
    expect(map.isLadiesOnly('L1')).toBe(false);
  });

  it('excludes non-bookable cells from the bookable count', () => {
    const props = validSeater();
    props.seats.push({ number: 'X1', deck: 0, row: 0, column: 2, type: 'seater', bookable: false });
    const map = SeatMap.create(props);
    expect(map.summary.totalSeats).toBe(5);
    expect(map.summary.bookableSeats).toBe(4);
    expect(map.isBookable('X1')).toBe(false);
    expect(map.bookableSeatNumbers()).not.toContain('X1');
  });

  it('round-trips through persistence', () => {
    const map = SeatMap.create(validSeater());
    const restored = SeatMap.fromPersistence(map.toPersistence());
    expect(restored.summary).toEqual(map.summary);
  });
});

describe('SeatMap — negative & edge cases', () => {
  it('rejects an empty layout', () => {
    expect(() => SeatMap.create({ decks: 1, rows: 1, columns: 1, seats: [] })).toThrow(
      /at least one seat/,
    );
  });

  it('rejects duplicate seat numbers', () => {
    const props = validSeater();
    props.seats[1].number = 'A1';
    expect(() => SeatMap.create(props)).toThrow(/Duplicate seat number 'A1'/);
  });

  it('rejects two seats overlapping the same cell', () => {
    const props = validSeater();
    props.seats[1] = { number: 'A2', deck: 0, row: 0, column: 0, type: 'seater' }; // same cell as A1
    expect(() => SeatMap.create(props)).toThrow(/overlaps another seat/);
  });

  it('rejects a berth that overflows the grid vertically', () => {
    expect(() =>
      SeatMap.create({
        decks: 1,
        rows: 1,
        columns: 1,
        seats: [{ number: 'L1', deck: 0, row: 0, column: 0, rowSpan: 2, type: 'sleeper' }],
      }),
    ).toThrow(/overflows the grid vertically/);
  });

  it('rejects a seat on a non-existent deck', () => {
    const props = validSeater();
    props.seats[0].deck = 1; // only 1 deck declared
    expect(() => SeatMap.create(props)).toThrow(/deck/);
  });

  it('rejects an out-of-range column', () => {
    const props = validSeater();
    props.seats[0].column = 9;
    expect(() => SeatMap.create(props)).toThrow(/overflows the grid horizontally/);
  });

  it('rejects an invalid seat number format', () => {
    const props = validSeater();
    props.seats[0].number = 'seat #1!';
    expect(() => SeatMap.create(props)).toThrow(/Invalid seat number/);
  });

  it('rejects more than 2 decks and zero rows', () => {
    expect(() =>
      SeatMap.create({ decks: 3, rows: 1, columns: 1, seats: validSeater().seats }),
    ).toThrow(/1 or 2 decks/);
    expect(() =>
      SeatMap.create({ decks: 1, rows: 0, columns: 1, seats: validSeater().seats }),
    ).toThrow(/rows must be/);
  });

  it('edge: a single-seat minibus layout is valid', () => {
    const map = SeatMap.create({
      decks: 1,
      rows: 1,
      columns: 1,
      seats: [{ number: '1', deck: 0, row: 0, column: 0, type: 'seater' }],
    });
    expect(map.seatCount).toBe(1);
  });

  it('edge: adjacent berths that touch but do not overlap are valid', () => {
    const map = SeatMap.create({
      decks: 1,
      rows: 4,
      columns: 1,
      seats: [
        { number: 'L1', deck: 0, row: 0, column: 0, rowSpan: 2, type: 'sleeper' },
        { number: 'L2', deck: 0, row: 2, column: 0, rowSpan: 2, type: 'sleeper' },
      ],
    });
    expect(map.summary.sleeper).toBe(2);
  });
});
