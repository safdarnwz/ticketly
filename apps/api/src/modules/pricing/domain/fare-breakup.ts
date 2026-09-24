import { Money, type CurrencyCode } from '@kernel';

/**
 * ============================================================================
 *  Fare breakup — an auditable, exact price decomposition
 * ============================================================================
 *
 * A fare is never a single number. A passenger, an operator's accountant, a tax
 * auditor and an OTA all need to see HOW a price was reached: base fare, dynamic
 * adjustment, discount, and the GST split (CGST/SGST/IGST). Storing only the
 * total is how disputes and tax-filing errors happen.
 *
 * Everything is `Money` (integer minor units), so the identity
 *   total == base + adjustment - discount + taxes
 * holds to the paisa at every step. `allocate()` (Part 1) guarantees per-seat
 * splits lose nothing.
 *
 * This value object is pure and holds no policy — it is the *result* shape the
 * pricing engine produces and the booking/ledger modules consume.
 */

export interface TaxComponent {
  name: string; // 'CGST' | 'SGST' | 'IGST'
  ratePct: number; // 2.5, 5, ...
  amount: Money;
}

export interface FareLine {
  /** What this line represents: 'base', 'dynamic', 'discount', 'coupon'. */
  kind: string;
  label: string;
  /** Positive adds to the fare; negative reduces it. */
  amount: Money;
}

export class FareBreakup {
  private constructor(
    readonly currency: CurrencyCode,
    readonly base: Money,
    readonly lines: FareLine[],
    readonly taxes: TaxComponent[],
  ) {}

  static build(input: {
    currency: CurrencyCode;
    base: Money;
    lines?: FareLine[];
    taxes?: TaxComponent[];
  }): FareBreakup {
    return new FareBreakup(input.currency, input.base, input.lines ?? [], input.taxes ?? []);
  }

  /** Sum of base + all adjustment lines (before tax). Never negative. */
  get netFare(): Money {
    const adjustments = this.lines.reduce(
      (acc, l) => acc.plus(l.amount),
      Money.zero(this.currency),
    );
    return this.base.plus(adjustments).clampZero();
  }

  get taxTotal(): Money {
    return this.taxes.reduce((acc, t) => acc.plus(t.amount), Money.zero(this.currency));
  }

  /** The amount the passenger pays. */
  get total(): Money {
    return this.netFare.plus(this.taxTotal);
  }

  /** Total discount applied (sum of negative lines, as a positive number). */
  get discountTotal(): Money {
    return this.lines
      .filter((l) => l.amount.isNegative())
      .reduce((acc, l) => acc.plus(l.amount.abs()), Money.zero(this.currency));
  }

  toJSON(): Record<string, unknown> {
    return {
      currency: this.currency,
      base: this.base.toJSON(),
      lines: this.lines.map((l) => ({ kind: l.kind, label: l.label, amount: l.amount.toJSON() })),
      taxes: this.taxes.map((t) => ({
        name: t.name,
        ratePct: t.ratePct,
        amount: t.amount.toJSON(),
      })),
      netFare: this.netFare.toJSON(),
      taxTotal: this.taxTotal.toJSON(),
      discount: this.discountTotal.toJSON(),
      total: this.total.toJSON(),
    };
  }
}
