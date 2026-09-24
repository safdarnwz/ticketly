import { describe, expect, it } from 'vitest';

import { applyConcessions, validatePassengers, type ConcessionRule } from '../domain/passenger-categories';

const rule = (o: Partial<ConcessionRule> & Pick<ConcessionRule, 'category'>): ConcessionRule => ({ discountPct: 0, minAge: null, maxAge: null, requiresIdProof: false, validFrom: null, validTo: null, maxPerBooking: null, active: true, ...o });
const rules = [
  rule({ category: 'senior', discountPct: 25, minAge: 60 }),
  rule({ category: 'child', discountPct: 50, minAge: 5, maxAge: 11 }),
  rule({ category: 'student', discountPct: 10, minAge: 12, maxAge: 30, requiresIdProof: true, validFrom: '2026-07-01', validTo: '2027-03-31' }),
  rule({ category: 'defence', discountPct: 15, requiresIdProof: true, maxPerBooking: 2 }),
];
const D = '2026-10-10';
const ok = (passengers: Parameters<typeof validatePassengers>[0]['passengers'], infants: Parameters<typeof validatePassengers>[0]['infants'] = []) => () => validatePassengers({ passengers, infants, rules, journeyDate: D });

describe('validatePassengers', () => {
  it('happy: family with senior, child and an infant on the adult', () => {
    expect(ok([{ seatNumber: '1', fullName: 'Asha', age: 64, category: 'senior' }, { seatNumber: '2', fullName: 'Ravi', age: 35 }, { seatNumber: '3', fullName: 'Mini', age: 8, category: 'child' }], [{ fullName: 'Baby', age: 1, guardianSeat: '2' }])).not.toThrow();
  });
  it('1214/1215: category must fit the age', () => {
    expect(ok([{ seatNumber: '1', fullName: 'Raj', age: 30, category: 'child' }, { seatNumber: '2', fullName: 'A', age: 40 }])).toThrow(/too old for the child/);
    expect(ok([{ seatNumber: '1', fullName: 'Old', age: 50, category: 'senior' }])).toThrow(/too young for the senior/);
    expect(ok([{ seatNumber: '1', fullName: 'Kid', category: 'child' }, { seatNumber: '2', fullName: 'A', age: 40 }])).toThrow(/Age is required/);
  });
  it('1549: ID proof for student/defence; 1547: concession calendar', () => {
    expect(ok([{ seatNumber: '1', fullName: 'Stu', age: 20, category: 'student' }])).toThrow(/ID proof/);
    expect(ok([{ seatNumber: '1', fullName: 'Stu', age: 20, category: 'student', idProof: 'DU-2231' }])).not.toThrow();
    expect(() => validatePassengers({ passengers: [{ seatNumber: '1', fullName: 'Stu', age: 20, category: 'student', idProof: 'DU-2231' }], infants: [], rules, journeyDate: '2027-05-01' })).toThrow(/ended on/);
  });
  it('max per booking; inactive / unknown concession', () => {
    const three = [1, 2, 3].map((n) => ({ seatNumber: String(n), fullName: `D${n}`, age: 40, category: 'defence' as const, idProof: 'ARMY-1' }));
    expect(ok(three)).toThrow(/At most 2/);
    expect(() => validatePassengers({ passengers: [{ seatNumber: '1', fullName: 'X', age: 70, category: 'senior' }], infants: [], rules: [rule({ category: 'senior', active: false })], journeyDate: D })).toThrow(/not offered/);
  });
  it('5007: children only is refused by default; 1216: infant needs an adult; one infant per adult', () => {
    expect(ok([{ seatNumber: '1', fullName: 'Kid', age: 9, category: 'child' }])).toThrow(/At least one adult/);
    expect(ok([{ seatNumber: '1', fullName: 'A', age: 30 }, { seatNumber: '2', fullName: 'Kid', age: 9, category: 'child' }], [{ fullName: 'B', age: 1, guardianSeat: '2' }])).toThrow(/with an adult/);
    expect(ok([{ seatNumber: '1', fullName: 'A', age: 30 }], [{ fullName: 'B1', age: 1, guardianSeat: '1' }, { fullName: 'B2', age: 2, guardianSeat: '1' }])).toThrow(/one infant per adult/);
    expect(ok([{ seatNumber: '1', fullName: 'A', age: 30 }], [{ fullName: 'B', age: 1, guardianSeat: '9' }])).toThrow(/not on it/);
  });
  it('a toddler given a seat, or an "infant" who is too old, is refused', () => {
    expect(ok([{ seatNumber: '1', fullName: 'Tiny', age: 3 }])).toThrow(/add them as an infant/);
    expect(ok([{ seatNumber: '1', fullName: 'A', age: 30 }], [{ fullName: 'Big', age: 7, guardianSeat: '1' }])).toThrow(/infants must be under 5/);
  });
});

describe('applyConcessions', () => {
  const totals = { baseMinor: 200000, discountMinor: 0, taxMinor: 10000, totalMinor: 210000 };
  const fares = () => new Map([['1', 105000], ['2', 105000]]);
  it('reduces the concession seat and keeps base − discount + tax = total', () => {
    const r = applyConcessions({ fareBySeat: fares(), passengers: [{ seatNumber: '1', fullName: 'S', age: 70, category: 'senior' }, { seatNumber: '2', fullName: 'A', age: 30 }], rules, totals, infantCount: 0 });
    expect(r.fareBySeat.get('1')).toBe(78750);
    expect(r.concessionMinor).toBe(26250);
    expect(r.totals.totalMinor).toBe(183750);
    expect(r.totals.baseMinor - r.totals.discountMinor + r.totals.taxMinor).toBe(r.totals.totalMinor);
    expect([...r.fareBySeat.values()].reduce((a, b) => a + b, 0)).toBe(r.totals.totalMinor);
  });
  it('no concession → totals untouched; infant fee is added and the invariant still holds', () => {
    expect(applyConcessions({ fareBySeat: fares(), passengers: [{ seatNumber: '1', fullName: 'A' }], rules, totals, infantCount: 0 }).totals).toEqual(totals);
    const r = applyConcessions({ fareBySeat: fares(), passengers: [{ seatNumber: '1', fullName: 'A' }], rules, totals, infantCount: 1, policy: { adultAge: 18, infantMaxAge: 5, infantFeeMinor: 5000, allowUnaccompaniedMinors: false } });
    expect(r.totals.totalMinor).toBe(215000);
    expect(r.totals.baseMinor - r.totals.discountMinor + r.totals.taxMinor).toBe(r.totals.totalMinor);
  });
});
