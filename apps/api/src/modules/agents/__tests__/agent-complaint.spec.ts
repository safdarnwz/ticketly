import { describe, expect, it } from 'vitest';

import { decideComplaint } from '../domain/agent-complaint';

describe('agent complaint decisions', () => {
  it('an open complaint takes either decision', () => {
    expect(decideComplaint('open', 'upheld')).toBe('apply');
    expect(decideComplaint('open', 'dismissed')).toBe('apply');
  });
  it('the same decision again is a retry; a different one is refused', () => {
    expect(decideComplaint('upheld', 'upheld')).toBe('noop');
    expect(decideComplaint('dismissed', 'dismissed')).toBe('noop');
    expect(decideComplaint('upheld', 'dismissed')).toBe('conflict');
    expect(decideComplaint('dismissed', 'upheld')).toBe('conflict');
  });
});
