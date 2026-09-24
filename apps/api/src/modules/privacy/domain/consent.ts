import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Consent (DPDP Act, 2023)
 * ============================================================================
 *
 * India's Digital Personal Data Protection Act requires that personal data be
 * processed only for a purpose the data principal has consented to, that consent
 * be as easy to withdraw as to give, and that certain processing (fulfilling the
 * service the user asked for) is a "legitimate use" that doesn't need separate
 * consent.
 *
 * This models consent as an append-only log of grant/withdraw events per
 * purpose; the current state is the LATEST event for that purpose. Necessary
 * purposes (running the booking the user is making) are always allowed. Pure and
 * deterministic — the allow/deny decision is fully testable.
 */

export type ConsentPurpose =
  | 'transactional'   // necessary: booking, ticketing, payment, refunds
  | 'marketing'       // promotional email/SMS/push
  | 'personalization' // recommendations, saved preferences
  | 'analytics'       // product analytics
  | 'third_party_share';

/** Purposes that are a legitimate use of the service and need no opt-in. */
const NECESSARY: ReadonlySet<ConsentPurpose> = new Set<ConsentPurpose>(['transactional']);

export interface ConsentEvent {
  purpose: ConsentPurpose;
  granted: boolean;
  atMs: number;
}

/** The current granted-state per purpose from the event log (latest wins). */
export function consentState(events: ConsentEvent[]): Record<string, boolean> {
  const latest = new Map<ConsentPurpose, ConsentEvent>();
  for (const e of events) {
    const cur = latest.get(e.purpose);
    if (!cur || e.atMs >= cur.atMs) latest.set(e.purpose, e);
  }
  const out: Record<string, boolean> = {};
  for (const [purpose, e] of latest) out[purpose] = e.granted;
  return out;
}

export function isProcessingAllowed(purpose: ConsentPurpose, events: ConsentEvent[]): boolean {
  if (NECESSARY.has(purpose)) return true;
  const state = consentState(events);
  return state[purpose] === true;
}

/**
 * Append a consent change. Withdrawing a NECESSARY purpose is rejected — you
 * cannot withdraw consent for the very service you are transacting.
 */
export function recordConsent(events: ConsentEvent[], change: ConsentEvent): ConsentEvent[] {
  if (NECESSARY.has(change.purpose) && !change.granted) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, `'${change.purpose}' is a necessary purpose and cannot be withdrawn`);
  }
  if (!Number.isFinite(change.atMs) || change.atMs <= 0) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'consent event needs a valid timestamp');
  }
  return [...events, change];
}
