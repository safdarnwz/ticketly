import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

/**
 * Commission computation — what the platform earns on a booking, and therefore
 * what the operator is owed. Pure and money-exact.
 *
 * A commission model is one of:
 *   - percent      : X% of the net fare (pre-tax)
 *   - flat         : a fixed amount per ticket
 *   - percent_plus : X% + a fixed per-ticket fee
 *
 * Commission is charged on the NET fare (excluding GST): GST is a pass-through
 * tax the platform collects and remits, never revenue to commission on.
 */
export type CommissionModel = 'percent' | 'flat' | 'percent_plus';

export interface CommissionConfig {
  model: CommissionModel;
  /** For percent / percent_plus: 0..100. */
  percent?: number;
  /** For flat / percent_plus: minor units per ticket. */
  flatMinor?: number;
  /** Cap the commission at this many minor units (optional). */
  capMinor?: number;
}

export interface CommissionResult {
  commission: Money;
  operatorShare: Money;
}

export function computeCommission(input: {
  netFareMinor: number; // pre-tax fare the commission applies to
  seatCount: number;
  config: CommissionConfig;
  currency?: CurrencyCode;
}): CommissionResult {
  const currency = input.currency ?? 'INR';
  if (input.netFareMinor < 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Net fare cannot be negative');
  }
  const net = Money.of(input.netFareMinor, currency);

  let commission: Money;
  switch (input.config.model) {
    case 'percent':
      commission = net.percent(input.config.percent ?? 0);
      break;
    case 'flat':
      commission = Money.of((input.config.flatMinor ?? 0) * input.seatCount, currency);
      break;
    case 'percent_plus':
      commission = net
        .percent(input.config.percent ?? 0)
        .plus(Money.of((input.config.flatMinor ?? 0) * input.seatCount, currency));
      break;
    default:
      commission = Money.zero(currency);
  }

  if (input.config.capMinor !== undefined) {
    commission = Money.min(commission, Money.of(input.config.capMinor, currency));
  }
  // Commission can never exceed the net fare.
  commission = Money.min(commission, net);

  return { commission, operatorShare: net.minus(commission).clampZero() };
}
