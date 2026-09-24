import { randomInt } from 'node:crypto';

/**
 * PNR (Passenger Name Record) code generation.
 *
 * A PNR is the human-facing booking reference a passenger quotes at the counter
 * or to support. Requirements:
 *  - short and readable (6 chars), no ambiguous characters (0/O, 1/I/L);
 *  - not sequential or guessable (a competitor must not infer daily volume, and
 *    a passenger must not be able to enumerate others' PNRs);
 *  - collision-safe at the database via a unique constraint — this generator is
 *    the first line, the constraint is the backstop (the service retries on the
 *    rare clash).
 *
 * With a 28-character alphabet and 6 positions there are ~4.8×10^8 codes; at a
 * few million bookings the birthday-collision rate is low and the unique index
 * catches the rest.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0,O,1,I,L

export function generatePnr(length = 6): string {
  let pnr = '';
  for (let i = 0; i < length; i += 1) pnr += ALPHABET[randomInt(0, ALPHABET.length)];
  return pnr;
}

/** A per-ticket code (PNR + seat suffix) for boarding QR payloads. */
export function ticketCode(pnr: string, seatNumber: string): string {
  return `${pnr}-${seatNumber}`;
}
