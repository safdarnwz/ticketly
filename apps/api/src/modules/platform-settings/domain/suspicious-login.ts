/**
 * Suspicious-login alert rules (#54).
 *
 * Two signals, each independently switchable:
 *  - repeated failures: N failed password attempts on one account inside the
 *    window (the account lockout itself is separate — this is the ALERT);
 *  - new IP: a successful platform-admin sign-in from an address that account
 *    has not used in its recent sessions.
 * Alerts go to the listed emails and are always audited.
 */
export interface SuspiciousLoginPolicy {
  enabled: boolean;
  failedAttemptsThreshold: number;
  windowMinutes: number;
  alertOnNewAdminIp: boolean;
  alertEmails: string[];
}

export const DEFAULT_SUSPICIOUS_LOGIN_POLICY: SuspiciousLoginPolicy = {
  enabled: false,
  failedAttemptsThreshold: 5,
  windowMinutes: 15,
  alertOnNewAdminIp: true,
  alertEmails: [],
};

export function normaliseSuspiciousLoginPolicy(stored: Partial<SuspiciousLoginPolicy> | null | undefined): SuspiciousLoginPolicy {
  return { ...DEFAULT_SUSPICIOUS_LOGIN_POLICY, ...(stored ?? {}) };
}

/** Alert exactly when the count CROSSES the threshold, not on every later failure. */
export function shouldAlertOnFailures(policy: SuspiciousLoginPolicy, failuresInWindow: number): boolean {
  return policy.enabled && failuresInWindow === policy.failedAttemptsThreshold;
}

/** A first-ever login has no history to compare against — not suspicious. */
export function shouldAlertOnNewIp(policy: SuspiciousLoginPolicy, ip: string | null | undefined, recentIps: string[]): boolean {
  if (!policy.enabled || !policy.alertOnNewAdminIp || !ip || recentIps.length === 0) return false;
  return !recentIps.includes(ip);
}
