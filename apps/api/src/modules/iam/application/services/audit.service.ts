import { Injectable } from '@nestjs/common';

import { getContext, toCsv, type Json, type TenantId, type UserId } from '@kernel';
import { Logger } from '@observability';

import {
  AuditLogRepository,
  type AuditLogEntry,
} from '../../infrastructure/persistence/audit-log.repository';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  changes?: Record<string, Json> | null;
  tenantId?: TenantId | null;
  actorId?: UserId | null;
  actorType?: string;
}

/**
 * Append-only audit trail.
 *
 * Records security- and money-significant actions (who suspended which
 * operator, who granted which role, who refunded which booking). Regulatory and
 * dispute-resolution requirements make this non-negotiable for a ticketing
 * platform.
 *
 * DESIGN CHOICES:
 *  - Actor, tenant, IP and correlation id are pulled from the ambient request
 *    context so call sites only pass the *what*, never the *who*.
 *  - A best-effort write: an audit failure must never fail the business action
 *    it describes (that would be a worse outcome than a missing log line), so
 *    errors are logged and swallowed. For actions where the audit MUST be
 *    atomic with the change, callers pass a transaction and use `recordInTx`.
 *  - `changes` diffs are expected to be pre-redacted by the caller — never log
 *    a raw password or card number here.
 */
const EXPORT_LIMIT = 100_000;

@Injectable()
export class AuditService {
  private readonly log: Logger;

  constructor(
    private readonly repo: AuditLogRepository,
    logger: Logger,
  ) {
    this.log = logger.forContext('AuditService');
  }

  /** Fire-and-forget audit write. Safe outside a transaction. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.write(entry);
    } catch (error) {
      this.log.error(error, 'failed to write audit entry', { action: entry.action });
    }
  }

  /**
   * Write an audit row inside the current transaction so it commits atomically
   * with the change. Use for the most sensitive actions (role grants, refunds).
   */
  async recordInTx(entry: AuditEntry): Promise<void> {
    await this.write(entry);
  }

  private async write(entry: AuditEntry): Promise<void> {
    const ctx = getContext();
    await this.repo.insert({
      tenantId: entry.tenantId ?? ctx?.tenantId ?? null,
      actorId: entry.actorId ?? ctx?.userId ?? null,
      actorType: entry.actorType ?? ctx?.actorType ?? 'system',
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      changes: entry.changes ? JSON.stringify(entry.changes) : null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
      correlationId: ctx?.correlationId ?? null,
    });
  }

  /** Platform-admin read — cross-tenant by design (see AuditLogRepository). */
  list(
    filter: { tenantId?: string; action?: string; resourceType?: string; limit?: number } = {},
  ): Promise<AuditLogEntry[]> {
    return this.repo.list({ ...filter, limit: Math.min(filter.limit ?? 100, 500) });
  }

  /**
   * The last `days` of the trail as CSV (#52 / #53), newest first. Capped at
   * EXPORT_LIMIT rows; `truncated` says when the cap was hit, so a caller can
   * narrow by operator or action rather than getting a silently partial file.
   */
  async exportCsv(filter: {
    days: number;
    tenantId?: string;
    action?: string;
  }): Promise<{ csv: string; rows: number; truncated: boolean }> {
    const since = new Date(Date.now() - filter.days * 86_400_000);
    const rows = await this.repo.list({ ...filter, since, limit: EXPORT_LIMIT + 1 });
    const truncated = rows.length > EXPORT_LIMIT;
    const kept = rows.slice(0, EXPORT_LIMIT);
    return {
      csv: toCsv(
        [
          'occurredAt',
          'tenantId',
          'actorType',
          'actorId',
          'action',
          'resourceType',
          'resourceId',
          'ip',
          'changes',
        ],
        kept,
      ),
      rows: kept.length,
      truncated,
    };
  }
}
