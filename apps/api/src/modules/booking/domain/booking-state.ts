import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Booking state machine
 * ============================================================================
 *
 * A booking moves through a strict lifecycle. Encoding the legal transitions in
 * one place — rather than scattering `if (status === …)` checks across services
 * — means an illegal transition (confirming a cancelled booking, cancelling one
 * that already departed) is impossible to express, and the rules are testable
 * in isolation.
 *
 *   pending ──hold seats──▶ held ──pay──▶ confirmed ──travel──▶ completed
 *      │                     │               │
 *      │                     ├─expire──▶ expired
 *      └──fail──▶ failed      └─cancel──▶ (from held or confirmed) cancelled
 *
 * `held` carries a TTL; if payment doesn't complete in time the seat-hold
 * sweeper (Part 9) moves it to `expired` and frees the seats.
 */
export type BookingStatus =
  | 'pending'    // created, seats not yet held
  | 'held'       // seats locked, awaiting payment (has hold_expires_at)
  | 'confirmed'  // paid, tickets issued
  | 'completed'  // trip travelled
  | 'cancelled'  // cancelled by passenger/operator (refund per policy)
  | 'expired'    // hold lapsed before payment
  | 'failed';    // creation/payment failed terminally

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['held', 'failed'],
  held: ['confirmed', 'expired', 'cancelled', 'failed'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  expired: [],
  failed: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throwing guard used by the booking aggregate/service. */
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      ErrorCode.BOOKING_INVALID_STATE,
      `Cannot move a booking from '${from}' to '${to}'`,
      { details: { from, to } },
    );
  }
}

/** A terminal status can never change again. */
export function isTerminal(status: BookingStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses in which seats are actively consuming inventory. */
export function holdsInventory(status: BookingStatus): boolean {
  return status === 'held' || status === 'confirmed' || status === 'completed';
}

/** Whether a booking in this status may be cancelled. */
export function isCancellable(status: BookingStatus): boolean {
  return status === 'held' || status === 'confirmed';
}
