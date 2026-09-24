/**
 * Default agent credit-limit policy (#44).
 *
 * Operators still set each postpaid agent's own limit; this platform policy
 * supplies the default when they don't, and caps how high any operator may go
 * (credit extended to an agent is money the operator is exposed to). A
 * prepaid agent never has credit, whatever the policy says.
 */
export interface AgentCreditPolicy {
  defaultCreditLimitMinor: number;
  /** null = no platform cap. */
  maxCreditLimitMinor: number | null;
}

export const DEFAULT_AGENT_CREDIT_POLICY: AgentCreditPolicy = { defaultCreditLimitMinor: 0, maxCreditLimitMinor: null };

export function normaliseAgentCreditPolicy(stored: Partial<AgentCreditPolicy> | null | undefined): AgentCreditPolicy {
  return { ...DEFAULT_AGENT_CREDIT_POLICY, ...(stored ?? {}) };
}

export function agentCreditPolicyError(p: AgentCreditPolicy): string | null {
  if (p.maxCreditLimitMinor !== null && p.defaultCreditLimitMinor > p.maxCreditLimitMinor) {
    return 'The default credit limit cannot exceed the maximum';
  }
  return null;
}

/** The limit to store for an agent, or an error when the requested one breaks the cap. */
export function resolveAgentCreditLimit(
  policy: AgentCreditPolicy,
  billingMode: 'prepaid' | 'postpaid',
  requestedMinor: number | undefined,
): { ok: true; creditLimitMinor: number } | { ok: false; error: string } {
  if (billingMode === 'prepaid') return { ok: true, creditLimitMinor: 0 };
  const limit = requestedMinor ?? policy.defaultCreditLimitMinor;
  if (policy.maxCreditLimitMinor !== null && limit > policy.maxCreditLimitMinor) {
    return { ok: false, error: `Credit limit cannot exceed the platform maximum of ₹${(policy.maxCreditLimitMinor / 100).toFixed(2)}` };
  }
  return { ok: true, creditLimitMinor: limit };
}
