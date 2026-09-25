import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';

export interface AuditLogRow {
  tenantId: string | null;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: string | null;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

export interface AuditLogEntry extends Record<string, unknown> {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: unknown;
  ip: string | null;
  occurredAt: Date;
}

export interface AuditLogFilter {
  tenantId?: string;
  /** Partial, case-insensitive match. */
  action?: string;
  resourceType?: string;
  /** Only entries at or after this instant. */
  since?: Date;
  limit: number;
}

/**
 * The append-only audit_log table. No RLS on it (never customer-facing), so
 * the platform admin's cross-tenant read is a plain query.
 */
@Injectable()
export class AuditLogRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(row: AuditLogRow): Promise<void> {
    await this.db.execute_(
      `INSERT INTO audit_log
         (tenant_id, actor_id, actor_type, action, resource_type, resource_id,
          changes, ip, user_agent, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.tenantId,
        row.actorId,
        row.actorType,
        row.action,
        row.resourceType,
        row.resourceId,
        row.changes,
        row.ip,
        row.userAgent,
        row.correlationId,
      ],
      { name: 'audit.write', primary: true },
    );
  }

  list(filter: AuditLogFilter): Promise<AuditLogEntry[]> {
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
    if (filter.since) {
      params.push(filter.since);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(filter.limit);
    return this.db.query(
      `SELECT id, tenant_id AS "tenantId", actor_id AS "actorId", actor_type AS "actorType",
              action, resource_type AS "resourceType", resource_id AS "resourceId",
              changes, ip, occurred_at AS "occurredAt"
         FROM audit_log ${where}
        ORDER BY occurred_at DESC LIMIT $${params.length}`,
      params,
      { name: 'audit.list', timeoutMs: 60_000 },
    );
  }

  /** How many times `action` was recorded against one resource in the last `minutes`. */
  async countRecent(action: string, resourceId: string, minutes: number): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM audit_log
        WHERE action = $1 AND resource_id = $2
          AND occurred_at > now() - make_interval(mins => $3)`,
      [action, resourceId, minutes],
      { name: 'audit.countRecent', primary: true },
    );
    return Number(row?.n ?? 0);
  }
}
