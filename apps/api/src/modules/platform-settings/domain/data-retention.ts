/**
 * Data retention policy (#75).
 *
 * How many days operational logs are kept before the worker purges them.
 * Deliberately limited to LOG-type tables: bookings, invoices, payments and
 * the ledger are statutory records (GST / Income-tax retention) and are never
 * purged by this policy; personal data erasure goes through the privacy
 * module's right-to-be-forgotten flow instead.
 *
 * `null` = keep forever. The audit log has a floor of 365 days so a
 * misconfigured policy can never wipe the trail of who changed it.
 */
export const RETENTION_TARGETS = {
  auditLogDays: { table: 'audit_log', column: 'occurred_at', minDays: 365 },
  notificationDays: { table: 'notifications', column: 'created_at', minDays: 30 },
  gpsPingDays: { table: 'gps_pings', column: 'recorded_at', minDays: 7 },
  webhookDeliveryDays: { table: 'webhook_deliveries', column: 'created_at', minDays: 7 },
  otpChallengeDays: { table: 'otp_challenges', column: 'created_at', minDays: 1 },
} as const;

export type RetentionKey = keyof typeof RETENTION_TARGETS;
export type DataRetentionPolicy = Record<RetentionKey, number | null>;

export const DEFAULT_DATA_RETENTION: DataRetentionPolicy = {
  auditLogDays: null,
  notificationDays: null,
  gpsPingDays: null,
  webhookDeliveryDays: null,
  otpChallengeDays: null,
};

export function normaliseDataRetention(
  stored: Partial<DataRetentionPolicy> | null | undefined,
): DataRetentionPolicy {
  return { ...DEFAULT_DATA_RETENTION, ...(stored ?? {}) };
}

export function dataRetentionErrors(policy: Partial<DataRetentionPolicy>): string[] {
  const errors: string[] = [];
  for (const [key, days] of Object.entries(policy) as [RetentionKey, number | null][]) {
    const target = RETENTION_TARGETS[key];
    if (!target) {
      errors.push(`unknown retention key '${key}'`);
      continue;
    }
    if (days !== null && days < target.minDays)
      errors.push(`${key} must be at least ${target.minDays} days (or null to keep forever)`);
  }
  return errors;
}
