import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Refund state machine
 * ============================================================================
 *
 * A refund is a small workflow, not a single event: it is initiated, sent to a
 * destination (the original payment source, or an alternate bank account the
 * customer supplies at cancel time), and the gateway later confirms it settled
 * — or it fails and must be retried or paid manually. Encoding the legal
 * transitions here makes an impossible state (a settled refund going back to
 * processing, a failed one silently marked settled) unrepresentable, and
 * keeps the rules testable.
 *
 *   initiated ──▶ processing ──▶ settled
 *       │             │
 *       │             └──▶ failed ──▶ processing   (retry)
 *       └──▶ cancelled                 └──▶ manual  (paid outside the gateway)
 *
 * DESTINATION: refund-to-source goes through the PSP (`processing` while it
 * works); refund-to-an-alternate-account has NO automated gateway at all — a
 * PSP can only ever refund back to the instrument that paid, never to an
 * arbitrary bank account — so it always starts `processing` too and is
 * settled by a human actually sending the transfer and marking it `manual`.
 */
export type RefundStatus = 'initiated' | 'processing' | 'settled' | 'failed' | 'cancelled' | 'manual';
export type RefundDestination = 'source' | 'alternate_account';

const TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  initiated: ['processing', 'cancelled'],
  processing: ['settled', 'failed'],
  failed: ['processing', 'manual', 'cancelled'],
  settled: [],
  cancelled: [],
  manual: [],
};

export function canRefundTransition(from: RefundStatus, to: RefundStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertRefundTransition(from: RefundStatus, to: RefundStatus): void {
  if (!canRefundTransition(from, to)) {
    throw new DomainError(ErrorCode.REFUND_NOT_ALLOWED, `A refund cannot move from '${from}' to '${to}'`, {
      details: { from, to },
    });
  }
}

export function isRefundTerminal(status: RefundStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * The first legal status for a newly created refund — always 'processing'
 * now that neither destination settles instantly (the wallet was the only
 * instant one, and it's been removed from the product entirely).
 */
export function initialStatusFor(destination: RefundDestination): RefundStatus {
  void destination; // kept in the signature — callers pass it, and a future destination MIGHT settle instantly again
  return 'processing';
}
