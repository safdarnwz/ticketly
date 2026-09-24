import { BadRequestError } from './errors';

/**
 * ============================================================================
 *  Money — integer minor units, never floats
 * ============================================================================
 *
 * A fare of ₹1,249.50 is stored and computed as `124950` paise. Reasons:
 *
 *  - IEEE-754 cannot represent 0.1 exactly. `0.1 + 0.2 !== 0.3`. In a system
 *    that computes commission on top of a discount on top of a segment fare and
 *    then reconciles against a payment gateway to the paisa, float drift is a
 *    guaranteed production incident.
 *  - Postgres column type is `bigint` (minor units), NOT `numeric`. bigint
 *    arithmetic is ~40x faster than numeric and JS `number` safely holds
 *    integers to 2^53 (₹90,071,992,547,409.91) which is far beyond any fare.
 *  - Rounding is explicit and auditable at every step (`allocate` guarantees
 *    the sum of parts equals the whole — no lost paisa).
 */

export type CurrencyCode = 'INR' | 'USD' | 'AED' | 'LKR' | 'NPR' | 'BDT';

interface CurrencyMeta {
  readonly exponent: number; // number of minor-unit decimal places
  readonly symbol: string;
  readonly locale: string;
}

const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  INR: { exponent: 2, symbol: '₹', locale: 'en-IN' },
  USD: { exponent: 2, symbol: '$', locale: 'en-US' },
  AED: { exponent: 2, symbol: 'AED', locale: 'ar-AE' },
  LKR: { exponent: 2, symbol: 'Rs', locale: 'si-LK' },
  NPR: { exponent: 2, symbol: 'Rs', locale: 'ne-NP' },
  BDT: { exponent: 2, symbol: 'Tk', locale: 'bn-BD' },
};

export type RoundingMode = 'half-up' | 'half-even' | 'up' | 'down';

export class Money {
  private constructor(
    /** Amount in minor units (paise for INR). Always an integer. */
    readonly minor: number,
    readonly currency: CurrencyCode,
  ) {}

  // ── construction ───────────────────────────────────────────────────────

  /** From minor units — the canonical constructor. Use for DB reads. */
  static of(minor: number, currency: CurrencyCode = 'INR'): Money {
    if (!Number.isSafeInteger(minor)) {
      throw new BadRequestError(`Money.of expects a safe integer of minor units, received ${minor}`);
    }
    return new Money(minor, currency);
  }

  /** From a major-unit decimal (e.g. user input "1249.50"). Rounds half-up. */
  static fromMajor(major: number | string, currency: CurrencyCode = 'INR'): Money {
    const value = typeof major === 'string' ? Number.parseFloat(major) : major;
    if (!Number.isFinite(value)) {
      throw new BadRequestError(`Invalid monetary amount: ${major}`);
    }
    const factor = 10 ** CURRENCIES[currency].exponent;
    return new Money(Math.round(value * factor), currency);
  }

  static zero(currency: CurrencyCode = 'INR'): Money {
    return new Money(0, currency);
  }

  // ── arithmetic ─────────────────────────────────────────────────────────

  plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /** Multiply by a scalar (quantity, or a rate like 1.05 for tax). */
  times(factor: number, mode: RoundingMode = 'half-up'): Money {
    return new Money(round(this.minor * factor, mode), this.currency);
  }

  /**
   * Percentage of this amount. `fare.percent(18)` = 18% GST component.
   * Kept separate from `times` so pricing code reads like the fare rule sheet.
   */
  percent(pct: number, mode: RoundingMode = 'half-up'): Money {
    return new Money(round((this.minor * pct) / 100, mode), this.currency);
  }

  dividedBy(divisor: number, mode: RoundingMode = 'half-up'): Money {
    if (divisor === 0) throw new BadRequestError('Division by zero');
    return new Money(round(this.minor / divisor, mode), this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  abs(): Money {
    return new Money(Math.abs(this.minor), this.currency);
  }

  /** Clamp to zero — refunds and discounts must never go negative. */
  clampZero(): Money {
    return this.minor < 0 ? Money.zero(this.currency) : this;
  }

  /**
   * Split into `n` parts (or by weights) with **no paisa lost**. The remainder
   * is distributed one minor unit at a time to the earliest parts.
   *
   *   Money.of(10000).allocate(3) -> [3334, 3333, 3333]
   *
   * Used for: splitting a booking total across passengers, splitting operator
   * commission across segments, apportioning a coupon across seats.
   */
  allocate(nOrWeights: number | number[]): Money[] {
    const weights = typeof nOrWeights === 'number' ? new Array(nOrWeights).fill(1) : nOrWeights;
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight <= 0) throw new BadRequestError('allocate() requires positive weights');

    const parts = weights.map((w) => Math.floor((this.minor * w) / totalWeight));
    let remainder = this.minor - parts.reduce((a, b) => a + b, 0);
    for (let i = 0; remainder > 0; i = (i + 1) % parts.length, remainder -= 1) {
      parts[i] += 1;
    }
    return parts.map((p) => new Money(p, this.currency));
  }

  // ── comparison ─────────────────────────────────────────────────────────

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }
  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor > other.minor;
  }
  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor >= other.minor;
  }
  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor < other.minor;
  }
  lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.minor <= other.minor;
  }
  isZero(): boolean {
    return this.minor === 0;
  }
  isPositive(): boolean {
    return this.minor > 0;
  }
  isNegative(): boolean {
    return this.minor < 0;
  }

  static min(...values: Money[]): Money {
    return values.reduce((a, b) => (a.lessThan(b) ? a : b));
  }
  static max(...values: Money[]): Money {
    return values.reduce((a, b) => (a.greaterThan(b) ? a : b));
  }
  static sum(values: Money[], currency: CurrencyCode = 'INR'): Money {
    return values.reduce((a, b) => a.plus(b), Money.zero(currency));
  }

  // ── projection ─────────────────────────────────────────────────────────

  /** Major-unit number. ONLY for display/export — never for further maths. */
  toMajor(): number {
    return this.minor / 10 ** CURRENCIES[this.currency].exponent;
  }

  /** Locale-formatted string, e.g. "₹1,249.50". */
  format(options: Intl.NumberFormatOptions = {}): string {
    const meta = CURRENCIES[this.currency];
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: meta.exponent,
      ...options,
    }).format(this.toMajor());
  }

  /** Wire format. Keeps minor units so no precision is lost in transit. */
  toJSON(): { amount: number; currency: CurrencyCode; display: string } {
    return { amount: this.minor, currency: this.currency, display: this.format() };
  }

  toString(): string {
    return `${this.minor} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new BadRequestError(
        `Currency mismatch: cannot combine ${this.currency} with ${other.currency}`,
      );
    }
  }
}

function round(value: number, mode: RoundingMode): number {
  switch (mode) {
    case 'up':
      return Math.ceil(value);
    case 'down':
      return Math.floor(value);
    case 'half-even': {
      const floor = Math.floor(value);
      const diff = value - floor;
      if (diff > 0.5) return floor + 1;
      if (diff < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
    }
    case 'half-up':
    default:
      // Math.round is "half up towards +Infinity"; for negatives we want the
      // magnitude rounded half-up so refunds mirror charges exactly.
      return value < 0 ? -Math.round(-value) : Math.round(value);
  }
}
