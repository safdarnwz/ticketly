import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { getContext, type Json, type TenantId, type UserId } from '@kernel';
import { Logger } from '@observability';

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
@Injectable()
export class AuditService {
  private readonly log: Logger;

  constructor(
    private readonly db: DatabaseService,
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
    await this.db.execute_(
      `INSERT INTO audit_log
         (tenant_id, actor_id, actor_type, action, resource_type, resource_id,
          changes, ip, user_agent, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        entry.tenantId ?? ctx?.tenantId ?? null,
        entry.actorId ?? ctx?.userId ?? null,
        entry.actorType ?? ctx?.actorType ?? 'system',
        entry.action,
        entry.resourceType,
        entry.resourceId ?? null,
        entry.changes ? JSON.stringify(entry.changes) : null,
        ctx?.ip ?? null,
        ctx?.userAgent ?? null,
        ctx?.correlationId ?? null,
      ],
      { name: 'audit.write', primary: true },
    );
  }

  /**
   * Platform-admin read — cross-tenant by design (super admin needs to see
   * every operator's sensitive actions, not just one). No RLS on this table
   * (it's append-only and never customer-facing), so a plain query is fine —
   * unlike bookings/appearance/etc. this doesn't need bypassRls.
   */
  async list(
    filter: { tenantId?: string; action?: string; resourceType?: string; limit?: number } = {},
  ): Promise<unknown[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.tenantId) {
      params.push(filter.tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (filter.action) {
      params.push(`%${filter.action}%`);
      conditions.push(`action ILIKE $${params.length}`);
    }
    if (filter.resourceType) {
      params.push(filter.resourceType);
      conditions.push(`resource_type = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Math.min(filter.limit ?? 100, 500));

    return this.db.query(
      `SELECT id, tenant_id AS "tenantId", actor_id AS "actorId", actor_type AS "actorType",
              action, resource_type AS "resourceType", resource_id AS "resourceId",
              changes, ip, occurred_at AS "occurredAt"
         FROM audit_log ${where}
        ORDER BY occurred_at DESC LIMIT $${params.length}`,
      params,
      { name: 'audit.list' },
    );
  }
}
