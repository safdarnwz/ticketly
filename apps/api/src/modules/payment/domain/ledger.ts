import { Money, DomainError, ErrorCode, type CurrencyCode } from '@kernel';

/**
 * ============================================================================
 *  Double-entry ledger — the financial source of truth
 * ============================================================================
 *
 * Every rupee that moves in the platform is recorded as a balanced set of
 * ledger postings: the sum of debits ALWAYS equals the sum of credits. This is
 * 700 years of accounting practice, and it is not optional for a system that
 * handles money — it is the only representation that lets you prove, at any
 * instant, that money was neither created nor destroyed, and reconcile against
 * a payment gateway to the paisa.
 *
 * ACCOUNTS (the chart of accounts the booking flow touches):
 *   - gateway_clearing   (asset)      money in transit from the PSP
 *   - operator_payable   (liability)  what we owe the operator
 *   - platform_revenue   (income)     our commission
 *   - tax_payable        (liability)  GST collected
 *   - customer_refunds   (expense)    refunds paid out
 *   - operator_wallet    (liability)  operator prepaid balance
 *
 * SIGN CONVENTION: a posting has an account and a signed amount. By convention a
 * positive amount is a DEBIT and a negative amount is a CREDIT. A transaction is
 * valid iff its postings sum to zero (Σ = 0). This single invariant is what the
 * `LedgerTransaction` guards.
 *
 * Pure and money-exact (integer minor units) → exhaustively testable, and the
 * balance of any account is just the sum of its postings.
 */

export type AccountType = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export interface Posting {
  account: string;
  /** Signed minor units. + = debit, - = credit. */
  amountMinor: number;
  /** Optional sub-reference (operator id, booking id) for per-entity balances. */
  ref?: string;
}

export interface LedgerEntryInput {
  /** Business event, e.g. 'booking.captured', 'refund.paid'. */
  type: string;
  currency: CurrencyCode;
  postings: Posting[];
  /** The aggregate this entry belongs to (booking id, settlement id). */
  sourceType: string;
  sourceId: string;
}

/**
 * A validated, balanced ledger transaction. Construction THROWS if debits and
 * credits do not net to zero — an unbalanced entry can never be persisted.
 */
export class LedgerTransaction {
  private constructor(
    readonly type: string,
    readonly currency: CurrencyCode,
    readonly postings: Posting[],
    readonly sourceType: string,
    readonly sourceId: string,
  ) {}

  static create(input: LedgerEntryInput): LedgerTransaction {
    if (input.postings.length < 2) {
      throw new DomainError(
        ErrorCode.LEDGER_UNBALANCED,
        'A ledger entry needs at least two postings',
      );
    }
    const sum = input.postings.reduce((acc, p) => acc + p.amountMinor, 0);
    if (sum !== 0) {
      throw new DomainError(
        ErrorCode.LEDGER_UNBALANCED,
        `Ledger entry does not balance: net ${sum} minor units (debits must equal credits)`,
      );
    }
    if (input.postings.some((p) => p.amountMinor === 0)) {
      throw new DomainError(ErrorCode.LEDGER_UNBALANCED, 'A posting cannot be zero');
    }
    return new LedgerTransaction(
      input.type,
      input.currency,
      input.postings,
      input.sourceType,
      input.sourceId,
    );
  }

  /** Total debited (sum of positive postings) — equals total credited. */
  get magnitude(): Money {
    const debits = this.postings
      .filter((p) => p.amountMinor > 0)
      .reduce((a, p) => a + p.amountMinor, 0);
    return Money.of(debits, this.currency);
  }
}

/**
 * ---------------------------------------------------------------------------
 *  Standard entry builders — the exact postings for each money event.
 * ---------------------------------------------------------------------------
 *  Centralising these means the accounting is defined once and reviewed once,
 *  not re-derived (and mis-derived) at each call site.
 */
export const LedgerAccounts = {
  GATEWAY_CLEARING: 'gateway_clearing',
  OPERATOR_PAYABLE: 'operator_payable',
  PLATFORM_REVENUE: 'platform_revenue',
  /** GST on the PLATFORM's OWN commission (facilitation service) — NEVER the ticket's transport GST, which is the operator's to remit (see captureEntry). */
  COMMISSION_TAX_PAYABLE: 'commission_tax_payable',
  CUSTOMER_REFUNDS: 'customer_refunds',
  OPERATOR_WALLET: 'operator_wallet',
} as const;

/**
 * Booking captured: money arrives from the PSP. The platform takes ONLY its
 * commission plus GST on that commission (its own taxable facilitation
 * service) — the fare AND the ticket's own GST both pass straight through to
 * the operator, because the OPERATOR is the actual transport supplier and is
 * the one who must remit that GST to the government, not the platform. This
 * used to carve the ticket's GST into a platform-held `tax_payable` liability
 * — money that was never the platform's to hold.
 *
 *   DR gateway_clearing        total                         (money arrives)
 *   CR operator_payable        total - commission - commissionGst  (fare + ticket GST, net of what the platform takes)
 *   CR platform_revenue        commission                    (platform's actual earning)
 *   CR commission_tax_payable  commissionGst                 (platform's OWN liability — GST on ITS service, remitted separately)
 */
export function captureEntry(input: {
  currency: CurrencyCode;
  bookingId: string;
  operatorId: string;
  totalMinor: number;
  commissionMinor: number;
  commissionGstMinor: number;
}): LedgerTransaction {
  const operatorShare = input.totalMinor - input.commissionMinor - input.commissionGstMinor;
  if (operatorShare < 0) {
    throw new DomainError(
      ErrorCode.LEDGER_UNBALANCED,
      'Commission + commission GST exceed the booking total',
    );
  }
  return LedgerTransaction.create({
    type: 'booking.captured',
    currency: input.currency,
    sourceType: 'booking',
    sourceId: input.bookingId,
    postings: [
      { account: LedgerAccounts.GATEWAY_CLEARING, amountMinor: input.totalMinor },
      {
        account: LedgerAccounts.OPERATOR_PAYABLE,
        amountMinor: -operatorShare,
        ref: input.operatorId,
      },
      { account: LedgerAccounts.PLATFORM_REVENUE, amountMinor: -input.commissionMinor },
      { account: LedgerAccounts.COMMISSION_TAX_PAYABLE, amountMinor: -input.commissionGstMinor },
    ].filter((p) => p.amountMinor !== 0),
  });
}

/**
 * Refund paid: reverse the operator's share, the platform's commission, AND
 * the commission's own GST, all in the SAME proportion they were captured in
 * — so a partial refund reverses exactly its share and the books stay at zero.
 *
 *   DR operator_payable        operatorClawback
 *   DR platform_revenue        commissionClawback
 *   DR commission_tax_payable  commissionGstClawback
 *   CR customer_refunds        refundTotal   (money leaving)
 */
export function refundEntry(input: {
  currency: CurrencyCode;
  bookingId: string;
  operatorId: string;
  refundMinor: number;
  operatorClawbackMinor: number;
  commissionClawbackMinor: number;
  commissionGstClawbackMinor: number;
}): LedgerTransaction {
  const postings: Posting[] = [
    {
      account: LedgerAccounts.OPERATOR_PAYABLE,
      amountMinor: input.operatorClawbackMinor,
      ref: input.operatorId,
    },
    { account: LedgerAccounts.PLATFORM_REVENUE, amountMinor: input.commissionClawbackMinor },
    {
      account: LedgerAccounts.COMMISSION_TAX_PAYABLE,
      amountMinor: input.commissionGstClawbackMinor,
    },
    { account: LedgerAccounts.CUSTOMER_REFUNDS, amountMinor: -input.refundMinor },
  ].filter((p) => p.amountMinor !== 0);
  return LedgerTransaction.create({
    type: 'refund.paid',
    currency: input.currency,
    sourceType: 'booking',
    sourceId: input.bookingId,
    postings,
  });
}

/**
 * Booking captured OFFLINE — the OPERATOR collected the money itself (a B2B
 * agent's prepaid deposit / postpaid account), so nothing ever reached the
 * platform's gateway. The platform is still owed its commission (+ GST on
 * it) for the sale it facilitated; that is netted out of what the platform
 * owes the operator, reducing the next settlement.
 *
 *   DR operator_payable        commission + commissionGst   (operator now owes us this)
 *   CR platform_revenue        commission
 *   CR commission_tax_payable  commissionGst
 *
 * gateway_clearing is deliberately untouched: booking it with a captureEntry
 * would make the settlement pay the operator a fare the platform never held.
 */
export function offlineCaptureEntry(input: {
  currency: CurrencyCode;
  bookingId: string;
  operatorId: string;
  commissionMinor: number;
  commissionGstMinor: number;
}): LedgerTransaction {
  const owed = input.commissionMinor + input.commissionGstMinor;
  return LedgerTransaction.create({
    type: 'booking.captured_offline',
    currency: input.currency,
    sourceType: 'booking',
    sourceId: input.bookingId,
    postings: [
      { account: LedgerAccounts.OPERATOR_PAYABLE, amountMinor: owed, ref: input.operatorId },
      { account: LedgerAccounts.PLATFORM_REVENUE, amountMinor: -input.commissionMinor },
      { account: LedgerAccounts.COMMISSION_TAX_PAYABLE, amountMinor: -input.commissionGstMinor },
    ].filter((p) => p.amountMinor !== 0),
  });
}

/**
 * Refund of an OFFLINE-captured booking. The operator returns the money to
 * the agent itself (agent_ledger refund_credit); the platform only gives back
 * the proportional share of its commission + commission GST.
 *
 *   DR platform_revenue        commissionClawback
 *   DR commission_tax_payable  commissionGstClawback
 *   CR operator_payable        commissionClawback + commissionGstClawback
 */
export function offlineRefundEntry(input: {
  currency: CurrencyCode;
  bookingId: string;
  operatorId: string;
  commissionClawbackMinor: number;
  commissionGstClawbackMinor: number;
}): LedgerTransaction | null {
  const total = input.commissionClawbackMinor + input.commissionGstClawbackMinor;
  if (total === 0) return null; // nothing to reverse — a zero-posting transaction is not a transaction
  return LedgerTransaction.create({
    type: 'refund.offline',
    currency: input.currency,
    sourceType: 'booking',
    sourceId: input.bookingId,
    postings: [
      { account: LedgerAccounts.PLATFORM_REVENUE, amountMinor: input.commissionClawbackMinor },
      {
        account: LedgerAccounts.COMMISSION_TAX_PAYABLE,
        amountMinor: input.commissionGstClawbackMinor,
      },
      { account: LedgerAccounts.OPERATOR_PAYABLE, amountMinor: -total, ref: input.operatorId },
    ].filter((p) => p.amountMinor !== 0),
  });
}

/**
 * A GDS partner (OTA / multi-operator agent) sold the ticket and paid the
 * platform only the NET price — the partner kept its commission, which the
 * OPERATOR bears (agreed per operator × partner). Posted right after the
 * normal captureEntry of the full ticket value:
 *
 *   DR operator_payable   partnerCommission   (operator's share reduced)
 *   CR gateway_clearing   partnerCommission   (platform received that much less)
 */
export function partnerCommissionEntry(input: {
  currency: CurrencyCode;
  bookingId: string;
  operatorId: string;
  partnerCommissionMinor: number;
}): LedgerTransaction | null {
  if (input.partnerCommissionMinor <= 0) return null;
  return LedgerTransaction.create({
    type: 'booking.partner_commission',
    currency: input.currency,
    sourceType: 'booking',
    sourceId: input.bookingId,
    postings: [
      {
        account: LedgerAccounts.OPERATOR_PAYABLE,
        amountMinor: input.partnerCommissionMinor,
        ref: input.operatorId,
      },
      { account: LedgerAccounts.GATEWAY_CLEARING, amountMinor: -input.partnerCommissionMinor },
    ],
  });
}

/** On a refund of a partner sale: the partner gives back its commission share → operator's share restored. */
export function partnerCommissionReversalEntry(input: {
  currency: CurrencyCode;
  bookingId: string;
  operatorId: string;
  clawbackMinor: number;
}): LedgerTransaction | null {
  if (input.clawbackMinor <= 0) return null;
  return LedgerTransaction.create({
    type: 'refund.partner_commission',
    currency: input.currency,
    sourceType: 'booking',
    sourceId: input.bookingId,
    postings: [
      { account: LedgerAccounts.GATEWAY_CLEARING, amountMinor: input.clawbackMinor },
      {
        account: LedgerAccounts.OPERATOR_PAYABLE,
        amountMinor: -input.clawbackMinor,
        ref: input.operatorId,
      },
    ],
  });
}

/**
 * Settlement: the platform pays out the operator's accrued payable to their
 * wallet / bank.
 *
 *   DR operator_payable   amount
 *   CR operator_wallet    amount
 */
export function settlementEntry(input: {
  currency: CurrencyCode;
  settlementId: string;
  operatorId: string;
  amountMinor: number;
}): LedgerTransaction {
  return LedgerTransaction.create({
    type: 'settlement.paid',
    currency: input.currency,
    sourceType: 'settlement',
    sourceId: input.settlementId,
    postings: [
      {
        account: LedgerAccounts.OPERATOR_PAYABLE,
        amountMinor: input.amountMinor,
        ref: input.operatorId,
      },
      {
        account: LedgerAccounts.OPERATOR_WALLET,
        amountMinor: -input.amountMinor,
        ref: input.operatorId,
      },
    ],
  });
}
