/**
 * Platform password policy (#27 min length, #28 complexity, #29 expiry).
 *
 * Pure: the policy is data stored in `platform_settings`, and these functions
 * decide whether a candidate password is acceptable and whether a stored one
 * has expired. Applies to every account that sets a password (staff, agents,
 * customers, operator owners) — the policy is platform-wide by design.
 */
export interface PasswordPolicy {
  /** 8–128. The hasher's own floor is 8, so nothing below that is allowed. */
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  /** 0 = passwords never expire. */
  expiryDays: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSymbol: false,
  expiryDays: 0,
};

export const PASSWORD_POLICY_LIMITS = {
  minLength: { min: 8, max: 128 },
  expiryDays: { min: 0, max: 3650 },
} as const;

/** Fill any missing field from the default — an older stored policy stays valid when a field is added. */
export function normalisePasswordPolicy(
  stored: Partial<PasswordPolicy> | null | undefined,
): PasswordPolicy {
  return { ...DEFAULT_PASSWORD_POLICY, ...(stored ?? {}) };
}

/** Human-readable reasons the password is rejected; empty = acceptable. */
export function passwordViolations(policy: PasswordPolicy, password: string): string[] {
  const out: string[] = [];
  if (password.length < policy.minLength)
    out.push(`must be at least ${policy.minLength} characters`);
  if (policy.requireUppercase && !/[A-Z]/.test(password))
    out.push('must contain an uppercase letter');
  if (policy.requireLowercase && !/[a-z]/.test(password))
    out.push('must contain a lowercase letter');
  if (policy.requireDigit && !/[0-9]/.test(password)) out.push('must contain a digit');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) out.push('must contain a symbol');
  return out;
}

export function isPasswordExpired(
  policy: PasswordPolicy,
  changedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (policy.expiryDays <= 0 || !changedAt) return false;
  return now.getTime() - changedAt.getTime() >= policy.expiryDays * 86_400_000;
}
