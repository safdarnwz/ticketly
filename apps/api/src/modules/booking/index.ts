/**
 * PUBLIC API of the booking module — the only things other modules may import.
 * (Anything else under booking/ is internal; see scripts/check-boundaries.ts.)
 */
export { ticketCode } from './domain/pnr';
export * from './application/services/booking.service';
export * from './domain/booking-state';
export * from './domain/refund-policy';
export * from './infrastructure/persistence/booking.repository';
export * from './infrastructure/persistence/seat-lock.repository';
export * from './infrastructure/persistence/seat-upgrade.repository';
