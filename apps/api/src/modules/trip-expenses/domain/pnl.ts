/**
 * ============================================================================
 *  Trip expenses & profit/loss — pure rules
 * ============================================================================
 *
 * Operator P&L for a trip (all integer paise):
 *   net fare      = ticket sales − GST collected    (GST is not income; it is remitted)
 *   net revenue   = net fare − platform commission − commission GST
 *   profit        = net revenue − expenses
 *   margin %      = profit / net fare  (null when there was no revenue)
 * Refunds are already netted: a cancelled seat's fare leaves the booking's
 * totals, and a voided expense leaves the expense sum.
 */
export const EXPENSE_CATEGORIES = [
  'diesel',
  'cng',
  'toll',
  'driver_bata',
  'cleaner_bata',
  'parking',
  'permit_fee',
  'state_tax',
  'repair',
  'food',
  'cleaning',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const MAX_EXPENSE_MINOR = 5_00_000_00; // ₹5,00,000 per entry — above this is almost certainly a typo
export const EXPENSE_BACKDATE_DAYS = 15; // expenses may be added up to 15 days after the trip

export class ExpenseRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseRuleError';
  }
}

export function validateExpense(input: {
  category: string;
  amountMinor: number;
  note?: string | null;
  tripStatus: string;
  tripDepartsAt: Date;
  now?: Date;
}): void {
  const now = input.now ?? new Date();
  if (!(EXPENSE_CATEGORIES as readonly string[]).includes(input.category))
    throw new ExpenseRuleError(`Unknown expense category '${input.category}'`);
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new ExpenseRuleError('Amount must be a positive whole number of paise');
  if (input.amountMinor > MAX_EXPENSE_MINOR)
    throw new ExpenseRuleError(
      'Amount is unusually large — split it or check for a typo (max ₹5,00,000 per entry)',
    );
  if (input.category === 'other' && (input.note?.trim().length ?? 0) < 3)
    throw new ExpenseRuleError('Describe an "other" expense in the note');
  if (input.tripStatus === 'cancelled')
    throw new ExpenseRuleError('Cannot add expenses to a cancelled trip');
  const lastDay = input.tripDepartsAt.getTime() + EXPENSE_BACKDATE_DAYS * 86_400_000;
  if (now.getTime() > lastDay)
    throw new ExpenseRuleError(
      `Expenses can only be added up to ${EXPENSE_BACKDATE_DAYS} days after the trip`,
    );
}

export interface PnlInput {
  salesMinor: number;
  gstMinor: number;
  commissionMinor: number;
  commissionGstMinor: number;
  expensesMinor: number;
  seatsSold: number;
  seatsTotal: number;
}
export interface Pnl extends PnlInput {
  netFareMinor: number;
  netRevenueMinor: number;
  profitMinor: number;
  marginPct: number | null;
  occupancyPct: number | null;
  costPerSeatMinor: number | null;
}

export function computePnl(i: PnlInput): Pnl {
  const netFareMinor = i.salesMinor - i.gstMinor;
  const netRevenueMinor = netFareMinor - i.commissionMinor - i.commissionGstMinor;
  const profitMinor = netRevenueMinor - i.expensesMinor;
  return {
    ...i,
    netFareMinor,
    netRevenueMinor,
    profitMinor,
    marginPct: netFareMinor > 0 ? Math.round((profitMinor / netFareMinor) * 10000) / 100 : null,
    occupancyPct: i.seatsTotal > 0 ? Math.round((i.seatsSold / i.seatsTotal) * 10000) / 100 : null,
    costPerSeatMinor: i.seatsSold > 0 ? Math.round(i.expensesMinor / i.seatsSold) : null,
  };
}

/** Sum trips into one P&L (route / bus / period totals). */
export function sumPnl(rows: PnlInput[]): Pnl {
  const t = rows.reduce<PnlInput>(
    (a, r) => ({
      salesMinor: a.salesMinor + r.salesMinor,
      gstMinor: a.gstMinor + r.gstMinor,
      commissionMinor: a.commissionMinor + r.commissionMinor,
      commissionGstMinor: a.commissionGstMinor + r.commissionGstMinor,
      expensesMinor: a.expensesMinor + r.expensesMinor,
      seatsSold: a.seatsSold + r.seatsSold,
      seatsTotal: a.seatsTotal + r.seatsTotal,
    }),
    {
      salesMinor: 0,
      gstMinor: 0,
      commissionMinor: 0,
      commissionGstMinor: 0,
      expensesMinor: 0,
      seatsSold: 0,
      seatsTotal: 0,
    },
  );
  return computePnl(t);
}
