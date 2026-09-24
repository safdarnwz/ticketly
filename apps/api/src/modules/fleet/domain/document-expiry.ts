import {
  addDays,
  compareLocalDate,
  daysBetween,
  type LocalDate,
} from '@kernel';

/**
 * ============================================================================
 *  Vehicle document expiry engine
 * ============================================================================
 *
 * An Indian commercial bus legally may not run without valid documents:
 *   - Permit (national / state route permit)
 *   - Insurance
 *   - Fitness Certificate
 *   - PUC (Pollution Under Control)
 *   - (optionally) Road Tax, Passenger Insurance
 *
 * Running a trip on an expired document risks the vehicle being impounded and
 * passengers stranded. So the platform must proactively surface documents that
 * are expiring, and — critically — must be able to answer "is this vehicle
 * road-legal on this journey date?" during scheduling (Part 5) so an
 * uninsured bus is never assigned to a trip.
 *
 * This is pure, date-only logic (no I/O), exhaustively tested. It works in
 * `LocalDate` (calendar days) because document validity is a calendar concept,
 * not an instant — an insurance policy expires at end-of-day on its date, in
 * the vehicle's local calendar.
 */

export type DocumentStatus = 'valid' | 'expiring_soon' | 'expired' | 'missing';

export interface VehicleDocument {
  type: string; // 'permit' | 'insurance' | 'fitness' | 'puc' | ...
  /** Null = document not on file at all. */
  expiresOn: LocalDate | null;
  /** Some documents also have a start date (permits). */
  validFrom?: LocalDate | null;
}

export interface DocumentEvaluation {
  type: string;
  status: DocumentStatus;
  expiresOn: LocalDate | null;
  /** Negative = already expired that many days ago. */
  daysUntilExpiry: number | null;
}

export interface FleetComplianceResult {
  /** True only when EVERY required document is valid (not expiring counts as ok). */
  roadLegal: boolean;
  evaluations: DocumentEvaluation[];
  /** Documents that block operation right now (expired or missing). */
  blocking: DocumentEvaluation[];
}

/**
 * The documents a vehicle must hold to legally operate. Operators can extend
 * this per their state's rules; these are the national baseline.
 */
export const REQUIRED_DOCUMENT_TYPES = ['permit', 'insurance', 'fitness', 'puc'] as const;

/**
 * Evaluate one document against a reference date.
 *
 * `warnWindowDays` is the "expiring soon" horizon (default 30). A document that
 * has a `validFrom` in the future is treated as not-yet-valid → `missing`
 * (it cannot be relied upon for a journey before it starts).
 */
export function evaluateDocument(
  doc: VehicleDocument,
  today: LocalDate,
  warnWindowDays = 30,
): DocumentEvaluation {
  if (!doc.expiresOn) {
    return { type: doc.type, status: 'missing', expiresOn: null, daysUntilExpiry: null };
  }

  if (doc.validFrom && compareLocalDate(doc.validFrom, today) > 0) {
    // Not yet in effect.
    return { type: doc.type, status: 'missing', expiresOn: doc.expiresOn, daysUntilExpiry: daysBetween(today, doc.expiresOn) };
  }

  const days = daysBetween(today, doc.expiresOn);
  let status: DocumentStatus;
  if (days < 0) status = 'expired';
  else if (days <= warnWindowDays) status = 'expiring_soon';
  else status = 'valid';

  return { type: doc.type, status, expiresOn: doc.expiresOn, daysUntilExpiry: days };
}

/**
 * Full compliance check for a vehicle. `roadLegal` is true only when every
 * REQUIRED document is present and not expired. "expiring_soon" is a warning,
 * not a blocker — the bus can still run today.
 */
export function evaluateFleetCompliance(
  documents: VehicleDocument[],
  today: LocalDate,
  options: { warnWindowDays?: number; requiredTypes?: readonly string[] } = {},
): FleetComplianceResult {
  const warn = options.warnWindowDays ?? 30;
  const required = options.requiredTypes ?? REQUIRED_DOCUMENT_TYPES;
  const byType = new Map(documents.map((d) => [d.type, d]));

  const evaluations: DocumentEvaluation[] = required.map((type) =>
    evaluateDocument(byType.get(type) ?? { type, expiresOn: null }, today, warn),
  );

  // Also evaluate any extra (non-required) documents the operator tracks.
  for (const doc of documents) {
    if (!required.includes(doc.type)) evaluations.push(evaluateDocument(doc, today, warn));
  }

  const blocking = evaluations.filter(
    (e) => required.includes(e.type) && (e.status === 'expired' || e.status === 'missing'),
  );

  return { roadLegal: blocking.length === 0, evaluations, blocking };
}

/**
 * Is the vehicle road-legal on a SPECIFIC future journey date? This is what
 * scheduling calls before assigning a vehicle to a trip: a document valid today
 * but expiring before the journey must not be treated as valid for that trip.
 */
export function isRoadLegalOn(
  documents: VehicleDocument[],
  journeyDate: LocalDate,
  requiredTypes: readonly string[] = REQUIRED_DOCUMENT_TYPES,
): boolean {
  const byType = new Map(documents.map((d) => [d.type, d]));
  return requiredTypes.every((type) => {
    const doc = byType.get(type);
    if (!doc?.expiresOn) return false;
    if (doc.validFrom && compareLocalDate(doc.validFrom, journeyDate) > 0) return false;
    // Valid through the end of its expiry day → must be >= journeyDate.
    return compareLocalDate(doc.expiresOn, journeyDate) >= 0;
  });
}

/**
 * Given documents, return those expiring within `horizonDays`, soonest first.
 * The worker (Part 9) runs this daily and emits `vehicle.document_expiring`
 * events that drive operator reminders.
 */
export function documentsExpiringWithin(
  documents: VehicleDocument[],
  today: LocalDate,
  horizonDays: number,
): DocumentEvaluation[] {
  const horizon = addDays(today, horizonDays);
  return documents
    .map((d) => evaluateDocument(d, today))
    .filter(
      (e) =>
        e.expiresOn !== null &&
        e.status !== 'missing' &&
        compareLocalDate(e.expiresOn, horizon) <= 0,
    )
    .sort((a, b) => (a.daysUntilExpiry ?? 0) - (b.daysUntilExpiry ?? 0));
}

export type PermitType = 'aitp' | 'stage_carriage' | 'state_tourist_permit' | 'contract_carriage';

/**
 * Separate from (and orthogonal to) isRoadLegalOn's document-EXPIRY check:
 * this is about whether the vehicle's permit CATEGORY is even compatible
 * with individual-seat sale to the public at all, regardless of whether
 * its permit document happens to be currently valid or expired.
 *
 * A contract-carriage permit legally means the whole vehicle is hired to
 * ONE party for their own private use (a wedding group, a corporate
 * outing) — not seats sold individually to strangers, which is exactly
 * what this entire platform does. A contract-carriage vehicle with a
 * perfectly valid, unexpired permit document is STILL never eligible
 * here — the category itself is the block, not its expiry.
 *
 * A null/unrecorded permitType is treated as NOT eligible (fails safe —
 * an operator hasn't yet told the platform what kind of permit a vehicle
 * holds, so it must not be silently assumed to be individual-sale-eligible
 * stage_carriage/AITP by default).
 */
export function isPermittedForIndividualSale(permitType: PermitType | null | undefined): boolean {
  return permitType === 'aitp' || permitType === 'stage_carriage' || permitType === 'state_tourist_permit';
}
