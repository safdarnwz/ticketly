import { describe, expect, it } from 'vitest';

import {
  concessionRuleProblem,
  DEFAULT_POLICY,
  policyProblem,
  type ConcessionRule,
} from '../domain/passenger-categories';

const today = '2026-10-01';
const rule = (r: Partial<ConcessionRule>): ConcessionRule => ({
  category: 'student',
  discountPct: 10,
  minAge: null,
  maxAge: null,
  requiresIdProof: false,
  validFrom: null,
  validTo: null,
  maxPerBooking: null,
  active: true,
  ...r,
});

describe('concession rules', () => {
  it('a child band stays below adult age and above infant age', () => {
    expect(concessionRuleProblem(rule({ category: 'child' }), DEFAULT_POLICY, today)).toMatch(
      /oldest age/,
    );
    expect(
      concessionRuleProblem(rule({ category: 'child', maxAge: 18 }), DEFAULT_POLICY, today),
    ).toMatch(/younger than/);
    expect(
      concessionRuleProblem(
        rule({ category: 'child', minAge: 2, maxAge: 12 }),
        DEFAULT_POLICY,
        today,
      ),
    ).toMatch(/infants/);
    expect(
      concessionRuleProblem(
        rule({ category: 'child', minAge: 5, maxAge: 12 }),
        DEFAULT_POLICY,
        today,
      ),
    ).toBeNull();
  });
  it('a senior band needs a lower age of at least adult age', () => {
    expect(concessionRuleProblem(rule({ category: 'senior' }), DEFAULT_POLICY, today)).toMatch(
      /age from which/,
    );
    expect(
      concessionRuleProblem(rule({ category: 'senior', minAge: 10 }), DEFAULT_POLICY, today),
    ).toMatch(/adult age/);
    expect(
      concessionRuleProblem(rule({ category: 'senior', minAge: 60 }), DEFAULT_POLICY, today),
    ).toBeNull();
  });
  it('refuses a 0% active rule and one that already ended', () => {
    expect(concessionRuleProblem(rule({ discountPct: 0 }), DEFAULT_POLICY, today)).toMatch(/0%/);
    expect(
      concessionRuleProblem(rule({ discountPct: 0, active: false }), DEFAULT_POLICY, today),
    ).toBeNull();
    expect(concessionRuleProblem(rule({ validTo: '2026-09-30' }), DEFAULT_POLICY, today)).toMatch(
      /passed/,
    );
  });
  it('the adult age cannot drop under an existing child band', () => {
    const child = rule({ category: 'child', minAge: 5, maxAge: 14 });
    expect(policyProblem({ ...DEFAULT_POLICY, adultAge: 14 }, [child])).toMatch(/lower it/);
    expect(policyProblem({ ...DEFAULT_POLICY, adultAge: 15 }, [child])).toBeNull();
  });
});
