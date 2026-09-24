/**
 * PUBLIC API of the booking module — the only things other modules may import.
 * (Anything else under booking/ is internal; see scripts/check-boundaries.ts.)
 */
export * from './booking.module';
export { ticketCode } from './domain/pnr';
