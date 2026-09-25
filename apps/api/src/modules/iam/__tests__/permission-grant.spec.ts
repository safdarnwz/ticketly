import { describe, expect, it } from 'vitest';

import { permissionGrantProblems } from '../domain/permission-grant';

describe('permissionGrantProblems', () => {
  const manager = new Set(['booking:read', 'booking:create', 'role:manage']);

  it('allows permissions the caller holds', () => {
    expect(permissionGrantProblems(['booking:read', 'booking:create'], manager)).toEqual([]);
  });

  it('refuses permissions the caller does not hold (no escalation)', () => {
    expect(permissionGrantProblems(['payment:refund'], manager)).toEqual([
      "you do not hold 'payment:refund' yourself",
    ]);
  });

  it('never grants platform permissions, even to a caller holding *', () => {
    const all = new Set(['*']);
    expect(
      permissionGrantProblems(['*', 'platform:admin', 'platform:operators'], all),
    ).toHaveLength(3);
    expect(permissionGrantProblems(['payment:refund'], all)).toEqual([]);
  });

  it('rejects permissions outside the catalogue', () => {
    expect(permissionGrantProblems(['booking:reed'], new Set(['*']))).toEqual([
      "unknown permission 'booking:reed'",
    ]);
  });
});
