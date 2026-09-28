/**
 * Government rules per state (liquor prohibition, smoking, tobacco…), set by
 * the platform. A route carries the rules of every state its stops are in —
 * worked out from the stops, never chosen — so an operator cannot leave one
 * off, and passengers see them under the seat map with the operator's own
 * policies.
 */
export const STATE_NORM_CATEGORIES = [
  'liquor',
  'smoking',
  'tobacco',
  'plastic',
  'pets',
  'luggage',
  'documents',
  'other',
] as const;
export type StateNormCategory = (typeof STATE_NORM_CATEGORIES)[number];

export interface StateNorm {
  id: string;
  stateId: string;
  stateName: string;
  category: StateNormCategory;
  title: string;
  body: string;
  isActive: boolean;
  updatedAt: Date;
}

export interface StateRules {
  stateId: string;
  stateName: string;
  norms: Pick<StateNorm, 'id' | 'category' | 'title' | 'body'>[];
}

/** Group active norms under the given states, keeping the states' order (a state with none keeps an empty list). */
export function groupByState(
  states: { id: string; name: string }[],
  norms: Pick<StateNorm, 'id' | 'stateId' | 'category' | 'title' | 'body'>[],
): StateRules[] {
  return states.map((s) => ({
    stateId: s.id,
    stateName: s.name,
    norms: norms
      .filter((n) => n.stateId === s.id)
      .map(({ id, category, title, body }) => ({ id, category, title, body })),
  }));
}
