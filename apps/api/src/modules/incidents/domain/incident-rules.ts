/**
 * ============================================================================
 *  Operational incidents — pure rules
 * ============================================================================
 *
 * One model for everything that goes wrong on the road: SOS / panic, medical,
 * security, accident, breakdown, route diversion, delay (with a category),
 * passenger complaint raised on board. Lost & found items have their own
 * register (see lost-found rules below).
 *
 *  - severity follows the type (SOS / medical / security / accident are
 *    CRITICAL and must be acknowledged within 5 minutes — else "overdue");
 *  - status: open → acknowledged → resolved → closed (no skipping back);
 *  - resolving needs a resolution note; location, if given, must be real.
 */
export const INCIDENT_TYPES = [
  'sos',
  'medical',
  'security',
  'accident',
  'breakdown',
  'diversion',
  'delay',
  'complaint',
  'other',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];
export type Severity = 'critical' | 'high' | 'normal';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved' | 'closed';
export const DELAY_CATEGORIES = [
  'traffic',
  'breakdown',
  'weather',
  'accident',
  'road_closure',
  'police_check',
  'passenger',
  'other',
] as const;
export const ACK_SLA_MINUTES: Record<Severity, number> = { critical: 5, high: 15, normal: 60 };

export class IncidentRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncidentRuleError';
  }
}

export function severityFor(type: IncidentType): Severity {
  if (type === 'sos' || type === 'medical' || type === 'security' || type === 'accident')
    return 'critical';
  if (type === 'breakdown' || type === 'diversion') return 'high';
  return 'normal';
}

export function validateReport(i: {
  type: string;
  description?: string;
  lat?: number;
  lng?: number;
  delayCategory?: string;
  delayMinutes?: number;
  diversionVia?: string;
}): void {
  if (!(INCIDENT_TYPES as readonly string[]).includes(i.type))
    throw new IncidentRuleError(`Unknown incident type '${i.type}'`);
  // SOS is one tap in an emergency — no typing required. Everything else needs a description.
  if (i.type !== 'sos' && (i.description?.trim().length ?? 0) < 5)
    throw new IncidentRuleError('Describe what happened (at least 5 characters)');
  if ((i.lat === undefined) !== (i.lng === undefined))
    throw new IncidentRuleError('Give both latitude and longitude, or neither');
  if (i.lat !== undefined && (!(i.lat >= -90 && i.lat <= 90) || !(i.lng! >= -180 && i.lng! <= 180)))
    throw new IncidentRuleError('Location is not a valid coordinate');
  if (i.type === 'delay') {
    if (!i.delayCategory || !(DELAY_CATEGORIES as readonly string[]).includes(i.delayCategory))
      throw new IncidentRuleError(`Choose a delay category: ${DELAY_CATEGORIES.join(', ')}`);
    if (!Number.isInteger(i.delayMinutes) || i.delayMinutes! < 1 || i.delayMinutes! > 24 * 60)
      throw new IncidentRuleError('Delay must be 1 minute to 24 hours');
  }
  if (i.type === 'diversion' && (i.diversionVia?.trim().length ?? 0) < 3)
    throw new IncidentRuleError('Say which way the bus is being diverted');
}

const NEXT: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['acknowledged', 'resolved'],
  acknowledged: ['resolved'],
  resolved: ['closed', 'acknowledged'],
  closed: [],
};

export function assertTransition(
  from: IncidentStatus,
  to: IncidentStatus,
  resolutionNote?: string,
): void {
  if (!NEXT[from].includes(to))
    throw new IncidentRuleError(`An incident that is ${from} cannot become ${to}`);
  if (to === 'resolved' && (resolutionNote?.trim().length ?? 0) < 5)
    throw new IncidentRuleError('Add a resolution note (at least 5 characters)');
}

export function isOverdue(
  i: { severity: Severity; status: IncidentStatus; reportedAt: Date },
  now: Date = new Date(),
): boolean {
  return (
    i.status === 'open' &&
    now.getTime() - i.reportedAt.getTime() > ACK_SLA_MINUTES[i.severity] * 60_000
  );
}

/* ─────────── lost & found ─────────── */

export type LostItemStatus = 'found' | 'claimed' | 'disposed';
export const UNCLAIMED_DISPOSAL_DAYS = 30;

/** A claim must come from a passenger of THAT trip (PNR check) and only while the item is held. */
export function checkClaim(i: {
  itemStatus: LostItemStatus;
  itemTripId: string | null;
  claimPnrTripId: string | null;
  claimantName: string;
}): string | null {
  if (i.itemStatus !== 'found') return `This item is already ${i.itemStatus}`;
  if (!i.claimantName?.trim() || i.claimantName.trim().length < 2)
    return 'Enter the claimant’s name';
  if (i.itemTripId && i.claimPnrTripId !== i.itemTripId)
    return 'That PNR is not for the trip this item was found on';
  return null;
}

export function canDispose(
  i: { itemStatus: LostItemStatus; foundAt: Date },
  now: Date = new Date(),
): string | null {
  if (i.itemStatus !== 'found') return `This item is already ${i.itemStatus}`;
  if (now.getTime() - i.foundAt.getTime() < UNCLAIMED_DISPOSAL_DAYS * 86_400_000)
    return `Unclaimed items are kept for ${UNCLAIMED_DISPOSAL_DAYS} days before disposal`;
  return null;
}
