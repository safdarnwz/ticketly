import { DomainError, ErrorCode } from '@kernel';

/**
 * ============================================================================
 *  Retention & erasure (DPDP Act, 2023)
 * ============================================================================
 *
 * Personal data must not be kept longer than necessary, and a data principal can
 * request erasure ("right to be forgotten"). Two pure pieces:
 *
 *  - RETENTION: given when a record was created and the policy's retention
 *    window, decide whether it is now due for purge — and when its deadline is.
 *
 *  - ERASURE: financial records (invoices, ledger) legally MUST be retained for
 *    years, so a full delete is wrong. Instead we ANONYMISE — redact the PII
 *    fields while keeping the non-personal financial shape intact. This computes
 *    which fields to redact and produces the redacted record, deterministically.
 */

export interface RetentionPolicy {
  category: string;
  retentionDays: number;
  /** When true, records are anonymised (PII redacted) rather than deleted. */
  anonymiseInsteadOfDelete: boolean;
}

const DAY_MS = 86_400_000;

export function retentionDeadlineMs(createdAtMs: number, retentionDays: number): number {
  if (retentionDays < 0)
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'retentionDays cannot be negative');
  return createdAtMs + retentionDays * DAY_MS;
}

export function isDueForPurge(createdAtMs: number, retentionDays: number, nowMs: number): boolean {
  return nowMs >= retentionDeadlineMs(createdAtMs, retentionDays);
}

export const DEFAULT_PII_FIELDS = [
  'fullName',
  'email',
  'phone',
  'contactEmail',
  'contactPhone',
  'address',
] as const;

/**
 * Produce an anonymised copy of a record: each present PII field is replaced with
 * a stable redaction marker. Non-PII fields are untouched, so financial/audit
 * shape survives. The input is not mutated.
 */
export function redactPii<T extends Record<string, unknown>>(
  record: T,
  piiFields: readonly string[] = DEFAULT_PII_FIELDS,
  marker = '[redacted]',
): T {
  const out: Record<string, unknown> = { ...record };
  for (const f of piiFields) {
    if (f in out && out[f] !== null && out[f] !== undefined) out[f] = marker;
  }
  return out as T;
}

export type ErasureAction = 'delete' | 'anonymise';

/** Whether an erasure request should delete or anonymise a given category. */
export function erasureActionFor(policy: RetentionPolicy): ErasureAction {
  return policy.anonymiseInsteadOfDelete ? 'anonymise' : 'delete';
}
