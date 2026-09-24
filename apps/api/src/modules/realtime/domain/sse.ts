import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Server-Sent Events framing + seat-availability deltas
 * ============================================================================
 *
 * The storefront subscribes to a trip's live seat availability over SSE, so a
 * seat someone else just booked greys out on your screen without a poll. Two
 * pure pieces:
 *
 *  - FRAMING: turn an event into a spec-correct SSE wire frame (each `data:`
 *    line prefixed, terminated by a blank line; multi-line data split correctly).
 *  - DELTA: diff the previous vs current available-seat sets so we push only what
 *    changed (which seats were taken, which freed), not the whole map each tick.
 *
 * Both are deterministic and framework-free, so the wire format and the diff are
 * unit-testable without a running server.
 */

export interface SseEvent {
  event?: string;
  data: unknown;   // serialised to JSON if not a string
  id?: string;
  retryMs?: number;
}

/** Encode one SSE frame per the text/event-stream spec (ends with a blank line). */
export function formatSseFrame(evt: SseEvent): string {
  if (evt.data === undefined) throw new DomainError(ErrorCode.COMMON_VALIDATION, 'SSE event needs data');
  const lines: string[] = [];
  if (evt.id) lines.push(`id: ${evt.id}`);
  if (evt.event) lines.push(`event: ${evt.event}`);
  if (evt.retryMs !== undefined) lines.push(`retry: ${evt.retryMs}`);
  const payload = typeof evt.data === 'string' ? evt.data : JSON.stringify(evt.data);
  // Every line of the data must carry its own `data:` prefix.
  for (const line of payload.split('\n')) lines.push(`data: ${line}`);
  return lines.join('\n') + '\n\n';
}

export interface SeatDelta {
  taken: string[];   // were available, now not
  freed: string[];   // were not available, now are
  changed: boolean;
}

/** Diff two available-seat sets into taken/freed lists (sorted, deterministic). */
export function seatDelta(prevAvailable: string[], nextAvailable: string[]): SeatDelta {
  const prev = new Set(prevAvailable);
  const next = new Set(nextAvailable);
  const taken = [...prev].filter((s) => !next.has(s)).sort();
  const freed = [...next].filter((s) => !prev.has(s)).sort();
  return { taken, freed, changed: taken.length > 0 || freed.length > 0 };
}
