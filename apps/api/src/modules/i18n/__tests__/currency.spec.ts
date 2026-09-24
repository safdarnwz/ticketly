import { describe, it, expect } from 'vitest';

import { convertMinor, formatMoney, minorScale } from '../domain/currency';

describe('minorScale', () => {
  it('knows scales for common currencies', () => {
    expect(minorScale('INR')).toBe(2);
    expect(minorScale('JPY')).toBe(0);
    expect(minorScale('KWD')).toBe(3);
  });
  it('negative: unknown currency throws', () => {
    expect(() => minorScale('XYZ')).toThrow();
  });
});

describe('convertMinor', () => {
  it('happy: INR→USD at 0.012 keeps integer minor units with half-up rounding', () => {
    // ₹1000.00 = 100000 paise; rate 0.012 USD/INR → $12.00 = 1200 cents
    expect(convertMinor(100000, 'INR', 'USD', 12000)).toBe(1200);
  });

  it('positive: handles a scale change to a 0-dp currency (JPY)', () => {
    // ₹100.00 = 10000 paise; rate 1.8 JPY/INR → ¥180 (0 dp)
    expect(convertMinor(10000, 'INR', 'JPY', 1_800_000)).toBe(180);
  });

  it('positive: handles a scale change to a 3-dp currency (KWD)', () => {
    // $1.00 = 100 cents; rate 0.31 KWD/USD → 0.310 KWD = 310 fils (3dp)
    expect(convertMinor(100, 'USD', 'KWD', 310_000)).toBe(310);
  });

  it('edge: rounds half up on the final minor unit', () => {
    // 1 cent * rate 1.005 → 1.005 cent → rounds to 1
    expect(convertMinor(1, 'USD', 'USD', 1_005_000)).toBe(1);
    // 1 cent * rate 1.5 → 1.5 → rounds to 2
    expect(convertMinor(1, 'USD', 'USD', 1_500_000)).toBe(2);
  });

  it('negative: non-integer amount or non-positive rate throws', () => {
    expect(() => convertMinor(1.5, 'INR', 'USD', 12000)).toThrow();
    expect(() => convertMinor(100, 'INR', 'USD', 0)).toThrow();
  });
});

describe('formatMoney', () => {
  it('happy: western grouping with 2dp and symbol', () => {
    expect(formatMoney(123456, 'USD')).toBe('$1,234.56');
  });
  it('positive: Indian grouping', () => {
    expect(formatMoney(1234567890, 'INR', 'in')).toBe('₹1,23,45,678.90');
  });
  it('positive: 0-dp currency has no decimals', () => {
    expect(formatMoney(180, 'JPY')).toBe('¥180');
  });
  it('edge: negatives and sub-unit padding', () => {
    expect(formatMoney(-5, 'USD')).toBe('-$0.05');
  });
});
