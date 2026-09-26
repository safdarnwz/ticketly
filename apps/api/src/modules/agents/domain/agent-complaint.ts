/**
 * A formal complaint against a travel agent: raised (open), then decided —
 * upheld (the agent was at fault) or dismissed — with what was decided. A
 * decision is final; recording the same decision again is a harmless retry.
 */
export const COMPLAINT_CATEGORIES = [
  'overcharging',
  'wrong_booking',
  'misbehaviour',
  'fraud',
  'other',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

export const COMPLAINT_OUTCOMES = ['upheld', 'dismissed'] as const;
export type ComplaintOutcome = (typeof COMPLAINT_OUTCOMES)[number];
export type ComplaintStatus = 'open' | ComplaintOutcome;

/** 'apply' the decision, 'noop' for a repeat of it, 'conflict' when a different one was already made. */
export function decideComplaint(
  current: ComplaintStatus,
  outcome: ComplaintOutcome,
): 'apply' | 'noop' | 'conflict' {
  if (current === 'open') return 'apply';
  return current === outcome ? 'noop' : 'conflict';
}
