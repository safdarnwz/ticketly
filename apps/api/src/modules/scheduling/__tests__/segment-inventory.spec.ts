import { describe, expect, it } from 'vitest';

import { SegmentMap } from '../domain/segment-inventory';

// Route A(0) B(1) C(2) D(3): legs 0=A-B, 1=B-C, 2=C-D
const map = SegmentMap.forStops(4);

describe('SegmentMap — segment masks', () => {
  it('computes the right leg mask for each segment', () => {
    expect(map.segmentMask(0, 1)).toBe(0b001n); // A-B → leg 0
    expect(map.segmentMask(1, 2)).toBe(0b010n); // B-C → leg 1
    expect(map.segmentMask(2, 3)).toBe(0b100n); // C-D → leg 2
    expect(map.segmentMask(0, 3)).toBe(0b111n); // A-D → all legs
    expect(map.segmentMask(0, 2)).toBe(0b011n); // A-C → legs 0,1
    expect(map.segmentMask(1, 3)).toBe(0b110n); // B-D → legs 1,2
  });
});

describe('SegmentMap — the core coexistence property', () => {
  it('a seat sold A→C is unavailable for A-B, A-C, B-C but free for C-D', () => {
    let occ = 0n;
    occ = map.occupy(occ, 0, 2); // book A→C
    expect(map.isFree(occ, 0, 1)).toBe(false); // A-B blocked
    expect(map.isFree(occ, 0, 2)).toBe(false); // A-C blocked
    expect(map.isFree(occ, 1, 2)).toBe(false); // B-C blocked
    expect(map.isFree(occ, 2, 3)).toBe(true); // C-D still free ✅
    expect(map.isFree(occ, 1, 3)).toBe(false); // B-D overlaps leg 1 → blocked
  });

  it('the SAME seat can be sold A→C and C→D to two passengers', () => {
    let occ = 0n;
    occ = map.occupy(occ, 0, 2); // passenger 1: A→C
    occ = map.occupy(occ, 2, 3); // passenger 2: C→D  (must succeed)
    expect(occ).toBe(0b111n);
    expect(map.isFree(occ, 0, 1)).toBe(false);
    expect(map.isFree(occ, 2, 3)).toBe(false);
  });

  it('rejects double-booking an overlapping segment', () => {
    const occ = map.occupy(0n, 0, 2); // A→C
    expect(() => map.occupy(occ, 1, 3)).toThrow(/already occupied/); // B→D overlaps leg 1
  });
});

describe('SegmentMap — release (cancellation)', () => {
  it('releasing a segment makes it bookable again', () => {
    let occ = map.occupy(0n, 0, 2); // A→C
    expect(map.isFree(occ, 0, 1)).toBe(false);
    occ = map.release(occ, 0, 2);
    expect(map.isEmpty(occ)).toBe(true);
    expect(map.isFree(occ, 0, 1)).toBe(true);
  });

  it('releasing one booking leaves the coexisting one intact', () => {
    let occ = map.occupy(0n, 0, 2); // A→C
    occ = map.occupy(occ, 2, 3); // C→D
    occ = map.release(occ, 0, 2); // cancel A→C
    expect(map.isFree(occ, 0, 2)).toBe(true); // A-C free again
    expect(map.isFree(occ, 2, 3)).toBe(false); // C-D still sold
  });
});

describe('SegmentMap — utilities & edges', () => {
  it('counts occupied legs and lists free sub-segments', () => {
    const occ = map.occupy(0n, 0, 2); // legs 0,1 busy
    expect(map.occupiedLegCount(occ)).toBe(2);
    expect(map.freeSegments(occ)).toEqual([{ from: 2, to: 3 }]);
  });

  it('lists two free gaps when the middle is occupied', () => {
    const five = SegmentMap.forStops(5); // legs 0..3
    const occ = five.occupy(0n, 1, 2); // leg 1 busy
    expect(five.freeSegments(occ)).toEqual([{ from: 0, to: 1 }, { from: 2, to: 4 }]);
  });

  it('rejects invalid segments', () => {
    expect(() => map.segmentMask(2, 2)).toThrow(); // zero-length
    expect(() => map.segmentMask(3, 1)).toThrow(); // reversed
    expect(() => map.segmentMask(0, 9)).toThrow(); // out of range
  });

  it('rejects too-few or too-many stops', () => {
    expect(() => SegmentMap.forStops(1)).toThrow(/at least 2 stops/);
    expect(() => SegmentMap.forStops(100)).toThrow(/not supported/);
  });

  it('edge: a 2-stop route has exactly one leg', () => {
    const two = SegmentMap.forStops(2);
    expect(two.segmentMask(0, 1)).toBe(0b1n);
    expect(two.isFree(0n, 0, 1)).toBe(true);
  });

  it('edge: correctness holds beyond 53-bit (BigInt) for long routes', () => {
    const long = SegmentMap.forStops(60); // 59 legs
    const occ = long.occupy(0n, 55, 58);
    expect(long.isFree(occ, 55, 56)).toBe(false);
    expect(long.isFree(occ, 58, 59)).toBe(true);
  });
});
