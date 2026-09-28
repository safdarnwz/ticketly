import { describe, expect, it } from 'vitest';

import { groupByState } from '../domain/state-norms';

/** A route carries the rules of every state it passes through, in route order. */
describe('groupByState', () => {
  const states = [
    { id: 'dl', name: 'Delhi' },
    { id: 'rj', name: 'Rajasthan' },
  ];

  it('puts each rule under its state, in the route’s order', () => {
    const out = groupByState(states, [
      { id: 'n2', stateId: 'rj', category: 'liquor', title: 'No drinking', body: 'b' },
      { id: 'n1', stateId: 'dl', category: 'smoking', title: 'No smoking', body: 'a' },
    ]);
    expect(out.map((s) => s.stateName)).toEqual(['Delhi', 'Rajasthan']);
    expect(out[0].norms.map((n) => n.id)).toEqual(['n1']);
    expect(out[1].norms.map((n) => n.id)).toEqual(['n2']);
  });

  it('keeps a state without rules, with an empty list', () => {
    expect(groupByState(states, [])).toEqual([
      { stateId: 'dl', stateName: 'Delhi', norms: [] },
      { stateId: 'rj', stateName: 'Rajasthan', norms: [] },
    ]);
  });

  it('drops rules of states the route does not pass through', () => {
    const out = groupByState(states, [
      { id: 'x', stateId: 'ka', category: 'other', title: 'Elsewhere', body: 'c' },
    ]);
    expect(out.flatMap((s) => s.norms)).toEqual([]);
  });
});
