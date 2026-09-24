import { describe, it, expect } from 'vitest';

import { scoreRisk, type RiskSignals } from '../domain/risk-scorer';

const clean = (o: Partial<RiskSignals> = {}): RiskSignals => ({
  accountAgeDays: 365,
  bookingsLast24h: 1,
  amountMinor: 50000,
  seatCount: 2,
  emailDisposable: false,
  paymentMethodNew: false,
  billingCountryMismatch: false,
  nightBooking: false,
  ...o,
});

describe('scoreRisk', () => {
  it('happy: an established customer with a normal order is low/allow', () => {
    const r = scoreRisk(clean());
    expect(r.score).toBe(0);
    expect(r.band).toBe('low');
    expect(r.decision).toBe('allow');
    expect(r.reasons).toHaveLength(0);
  });

  it('positive: a brand-new account buying big at night lands in review', () => {
    const r = scoreRisk(clean({ accountAgeDays: 0, amountMinor: 600000, nightBooking: true }));
    // 20 (new) + 10 (high value) + 5 (night) = 35 → still low
    expect(r.score).toBe(35);
    expect(r.decision).toBe('allow');
  });

  it('positive: crosses into review (medium) band at 40', () => {
    const r = scoreRisk(clean({ accountAgeDays: 0, bookingsLast24h: 5, amountMinor: 600000 }));
    // 20 + 15 + 10 = 45
    expect(r.score).toBe(45);
    expect(r.band).toBe('medium');
    expect(r.decision).toBe('review');
  });

  it('positive: a classic fraud pattern is denied and score caps at 100', () => {
    const r = scoreRisk(clean({
      accountAgeDays: 0, bookingsLast24h: 12, amountMinor: 2000000, seatCount: 10,
      emailDisposable: true, paymentMethodNew: true, billingCountryMismatch: true, nightBooking: true,
    }));
    // 20+30+20+15+20+10+20+5 = 140 → capped 100
    expect(r.score).toBe(100);
    expect(r.band).toBe('high');
    expect(r.decision).toBe('deny');
  });

  it('positive: reasons are attributable and sorted by weight', () => {
    const r = scoreRisk(clean({ accountAgeDays: 0, bookingsLast24h: 12 }));
    expect(r.reasons[0].code).toBe('very_high_velocity'); // 30 first
    expect(r.reasons.map((x) => x.code)).toContain('brand_new_account');
  });

  it('edge: 7-day-old account is "new" (10) not "brand new" (20)', () => {
    expect(scoreRisk(clean({ accountAgeDays: 3 })).score).toBe(10);
    expect(scoreRisk(clean({ accountAgeDays: 7 })).score).toBe(0); // boundary: not < 7
  });

  it('negative: negative signals throw', () => {
    expect(() => scoreRisk(clean({ amountMinor: -1 }))).toThrow();
    expect(() => scoreRisk(clean({ accountAgeDays: -5 }))).toThrow();
  });
});
