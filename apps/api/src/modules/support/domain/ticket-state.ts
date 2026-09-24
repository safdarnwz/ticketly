import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Support ticket state machine
 * ============================================================================
 *
 *   open ⇄ pending ──▶ resolved ──▶ closed
 *     └──────────────────┴──────────▶ closed
 *
 * `open`     — awaiting an agent.
 * `pending`  — waiting on the customer (agent replied, needs info).
 * `resolved` — agent believes it's done; can be reopened if the customer replies.
 * `closed`   — terminal.
 *
 * A reply can bounce a ticket between open/pending/resolved; only `closed` is
 * terminal. Encoding it here keeps the workflow rules in one testable place.
 */
export const TICKET_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['pending', 'resolved', 'closed'],
  pending: ['open', 'resolved', 'closed'],
  resolved: ['open', 'closed'],
  closed: [],
};

export function canTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTicketTransition(from: TicketStatus, to: TicketStatus): void {
  if (from === to) return; // a no-op transition is harmless (idempotent status set)
  if (!canTicketTransition(from, to)) {
    throw new DomainError(
      ErrorCode.SUPPORT_INVALID_TRANSITION,
      `A ticket cannot move from '${from}' to '${to}'`,
      {
        details: { from, to },
      },
    );
  }
}

export function isTicketClosed(status: TicketStatus): boolean {
  return status === 'closed';
}

/**
 * Where a new message drives the ticket, given who sent it. A customer reply
 * reopens a pending/resolved ticket (needs attention again); an agent reply on
 * an open ticket moves it to pending (waiting on the customer). Returns the same
 * status when no move is warranted.
 */
export function statusAfterMessage(
  current: TicketStatus,
  authorKind: 'customer' | 'agent' | 'system',
): TicketStatus {
  if (current === 'closed') return 'closed';
  if (authorKind === 'customer') return 'open'; // any customer reply → needs an agent again
  if (authorKind === 'agent') return current === 'open' ? 'pending' : current; // agent picks up an open ticket → pending
  return current; // system note doesn't move it
}
