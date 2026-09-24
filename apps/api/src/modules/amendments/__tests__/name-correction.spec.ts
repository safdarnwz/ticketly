import { describe, expect, it } from 'vitest';

import { checkNameCorrection, editDistance } from '../domain/name-correction';

const board = new Date('2026-10-02T20:00:00Z');
const now = new Date('2026-10-01T10:00:00Z');
const ok = (oldName: string, newName: string, previousCorrections = 0) =>
  checkNameCorrection({ oldName, newName, previousCorrections, boardingAt: board, now });

describe('name correction (510)', () => {
  it('spelling / case / spacing fixes are allowed', () => {
    expect(ok('Rahul Shrma', 'Rahul Sharma')).toBeNull();
    expect(ok('RAHUL  SHARMA', 'Rahul Sharma')).toBeNull();
    expect(ok('Priya K', 'Priya Kumari')).toMatch(/different person/); // 5 letters added to a short name
  });
  it('a different person is a transfer, not a correction', () => {
    expect(ok('Rahul Sharma', 'Amit Verma')).toMatch(/different person/);
  });
  it('limits: unchanged, too many corrections, too close to boarding, junk', () => {
    expect(ok('Rahul Sharma', 'Rahul Sharma')).toMatch(/unchanged/);
    expect(ok('Rahul Shrma', 'Rahul Sharma', 2)).toMatch(/at most 2/);
    expect(
      checkNameCorrection({
        oldName: 'Rahul Shrma',
        newName: 'Rahul Sharma',
        previousCorrections: 0,
        boardingAt: board,
        now: new Date('2026-10-02T19:30:00Z'),
      }),
    ).toMatch(/60 minutes/);
    expect(ok('Rahul', 'R4hul')).toMatch(/letters/);
    expect(ok('Rahul', ' ')).toMatch(/full name/);
  });
  it('edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
