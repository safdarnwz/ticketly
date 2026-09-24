import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Multi-currency conversion & formatting
 * ============================================================================
 *
 * Prices are stored in integer MINOR units of a base currency (paise). To show a
 * fare in another currency we convert on the fly at a quoted rate — and, exactly
 * like everywhere else in the platform, we do it in integers with an explicit
 * rounding step so no sub-unit is ever invented or lost. Different currencies
 * have different minor scales (INR/USD = 2 dp, JPY = 0, BHD = 3), which the
 * conversion must respect.
 *
 * Rates are passed in as micro-units (rate × 1e6) so the caller can hold an
 * exact decimal rate without floats leaking in. Everything here is pure.
 */

const MINOR_SCALE: Record<string, number> = {
  INR: 2, USD: 2, EUR: 2, GBP: 2, AED: 2, SGD: 2, AUD: 2, CAD: 2,
  JPY: 0, KWD: 3, BHD: 3, OMR: 3,
};

export function minorScale(currency: string): number {
  const s = MINOR_SCALE[currency.toUpperCase()];
  if (s === undefined) throw new DomainError(ErrorCode.COMMON_VALIDATION, `Unknown currency '${currency}'`);
  return s;
}

/**
 * Convert an amount in `from`'s minor units to `to`'s minor units at
 * `rateMicros` (units of `to` per 1 unit of `from`, × 1e6). Half-up rounding on
 * the final minor unit.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rateMicros: number): number {
  if (!Number.isInteger(amountMinor)) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'amountMinor must be an integer');
  if (rateMicros <= 0) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'rate must be positive');
  const fromScale = minorScale(from);
  const toScale = minorScale(to);

  // value_in_to_units = amountMinor / 10^fromScale * (rateMicros / 1e6)
  // target_minor = round(value_in_to_units * 10^toScale)
  //             = round(amountMinor * rateMicros * 10^toScale / (1e6 * 10^fromScale))
  const numerator = BigInt(amountMinor) * BigInt(rateMicros) * 10n ** BigInt(toScale);
  const denominator = 1_000_000n * 10n ** BigInt(fromScale);
  return Number(roundedDiv(numerator, denominator));
}

/** Integer half-up division for non-negative denominators. */
function roundedDiv(num: bigint, den: bigint): bigint {
  const neg = num < 0n;
  const n = neg ? -num : num;
  const q = n / den;
  const r = n % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return neg ? -rounded : rounded;
}

const SYMBOL: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AED: 'د.إ', SGD: 'S$', AUD: 'A$', CAD: 'C$',
};

/**
 * Format minor units as a human string. `grouping` picks the digit grouping —
 * 'in' for the Indian system (1,23,456) or 'western' (123,456). Deterministic
 * (no Intl dependency) so output is stable across environments and testable.
 */
export function formatMoney(amountMinor: number, currency: string, grouping: 'western' | 'in' = 'western'): string {
  const scale = minorScale(currency);
  const neg = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const factor = 10 ** scale;
  const whole = Math.floor(abs / factor);
  const frac = abs - whole * factor;

  const grouped = grouping === 'in' ? groupIndian(whole) : groupWestern(whole);
  const fracStr = scale > 0 ? '.' + String(frac).padStart(scale, '0') : '';
  const symbol = SYMBOL[currency.toUpperCase()] ?? currency.toUpperCase() + ' ';
  return `${neg ? '-' : ''}${symbol}${grouped}${fracStr}`;
}

function groupWestern(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}
