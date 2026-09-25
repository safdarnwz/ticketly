import { get } from './client';

export interface AuditEntry {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  changes: Record<string, unknown> | null;
  ip: string | null;
  occurredAt: string;
}

export const auditApi = {
  list: (filter: { tenantId?: string; action?: string; resourceType?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.tenantId) params.set('tenantId', filter.tenantId);
    if (filter.action) params.set('action', filter.action);
    if (filter.resourceType) params.set('resourceType', filter.resourceType);
    const qs = params.toString();
    return get<{ entries: AuditEntry[] }>(`/v1/admin/tenants/audit-log${qs ? `?${qs}` : ''}`);
  },
};
