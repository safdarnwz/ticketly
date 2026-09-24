/**
 * ============================================================================
 *  B2B agent account — pure domain logic
 * ============================================================================
 *
 * One signed balance models both billing modes (see migration 0049):
 *   prepaid  → balance >= 0, credit limit is always 0
 *   postpaid → balance may go negative, down to -creditLimit
 *   spendable = balance + creditLimit
 *
 * Commission is earned on the NET fare (ticket value minus GST) — GST is a
 * pass-through the operator must remit in full whichever channel sold the
 * ticket, so an agent can never earn commission on tax. The agent's account
 * is charged the FULL ticket value and credited the commission as a separate
 * line, so a statement shows gross sales and earnings, not one opaque net.
 *
 * Integer minor units throughout; no I/O, so every rule is unit-tested.
 */

export const AGENT_STATUSES = ['pending', 'active', 'suspended', 'rejected'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type BillingMode = 'prepaid' | 'postpaid';

export type AgentLedgerKind =
  | 'deposit'
  | 'payment_received'
  | 'booking_debit'
  | 'commission_credit'
  | 'booking_reversal'
  | 'refund_credit'
  | 'commission_reversal'
  | 'adjustment';

/** Which way each kind moves the balance; 'adjustment' carries its own sign. */
const SIGN: Record<Exclude<AgentLedgerKind, 'adjustment'>, 1 | -1> = {
  deposit: 1,
  payment_received: 1,
  booking_debit: -1,
  commission_credit: 1,
  booking_reversal: 1,
  refund_credit: 1,
  commission_reversal: -1,
};

/** Signed ledger amount for a kind + an unsigned magnitude. */
export function signedAmount(kind: AgentLedgerKind, magnitudeMinor: number): number {
  if (!Number.isInteger(magnitudeMinor))
    throw new Error('Amount must be an integer number of minor units');
  if (kind === 'adjustment') return magnitudeMinor;
  if (magnitudeMinor <= 0) throw new Error(`A ${kind} must be a positive amount`);
  return SIGN[kind] * magnitudeMinor;
}

export function spendableMinor(balanceMinor: number, creditLimitMinor: number): number {
  return balanceMinor + creditLimitMinor;
}

/**
 * Commission on the net fare, rounded half-up to the paisa. pct is the
 * agent's percentage (e.g. 5 or 7.5).
 */
export function agentCommissionMinor(totalMinor: number, taxMinor: number, pct: number): number {
  const net = Math.max(0, totalMinor - taxMinor);
  if (pct <= 0 || net === 0) return 0;
  return Math.round((net * pct) / 100);
}

/**
 * The agent's NET cost of a sale — what their spendable balance must cover.
 * They collect the full ticket value from the passenger and keep the
 * commission, so only (total - commission) is actually owed to the operator.
 */
export function netCostMinor(totalMinor: number, commissionMinor: number): number {
  return totalMinor - commissionMinor;
}

export interface FundsCheck {
  ok: boolean;
  shortfallMinor: number;
}

export function checkFunds(input: {
  balanceMinor: number;
  creditLimitMinor: number;
  totalMinor: number;
  commissionMinor: number;
}): FundsCheck {
  const need = netCostMinor(input.totalMinor, input.commissionMinor);
  const have = spendableMinor(input.balanceMinor, input.creditLimitMinor);
  return have >= need
    ? { ok: true, shortfallMinor: 0 }
    : { ok: false, shortfallMinor: need - have };
}

/** A balance at or below the alert threshold (only meaningful when a threshold is set). */
export function isLowBalance(
  balanceMinor: number,
  creditLimitMinor: number,
  alertMinor: number,
): boolean {
  return alertMinor > 0 && spendableMinor(balanceMinor, creditLimitMinor) <= alertMinor;
}

/**
 * Status transitions an operator may make. 'pending' is the only entry
 * state; 'rejected' is terminal; active ⇄ suspended is the normal lever.
 */
const TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  pending: ['active', 'rejected'],
  active: ['suspended'],
  suspended: ['active'],
  rejected: [],
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Billing-mode / credit-limit invariants (mirrors the DB CHECKs so the API
 * returns a clear 422 instead of a constraint-violation).
 */
export function validateTerms(input: {
  billingMode: BillingMode;
  creditLimitMinor: number;
  balanceMinor?: number;
}): string | null {
  if (input.creditLimitMinor < 0) return 'Credit limit cannot be negative';
  if (input.billingMode === 'prepaid' && input.creditLimitMinor !== 0)
    return 'A prepaid agent cannot have a credit limit';
  const balance = input.balanceMinor ?? 0;
  if (balance + input.creditLimitMinor < 0) {
    return 'The agent already owes more than this credit limit — collect payment first or keep a higher limit';
  }
  return null;
}
