import { del, download, get, post, put, withIdempotency } from './client';

/* ── Integrations (#11–#21) ─────────────────────────────────────────────── */
export interface IntegrationField { key: string; type: 'text' | 'number' | 'boolean' | 'choice'; required: boolean; options?: string[]; defaultValue?: unknown }
export interface Integration {
  provider: string; label: string; kind: 'payment' | 'sms' | 'whatsapp' | 'email'; runtime: 'live' | 'restart' | 'none';
  fields: { config: IntegrationField[]; secrets: IntegrationField[] };
  enabled: boolean; configured: boolean; config: Record<string, unknown>;
  /** Secret field → masked hint ("ab••••••wxyz"), null when not set. */
  secrets: Record<string, string | null>;
  lastTest: { at: string; ok: boolean; error: string | null } | null; updatedAt: string | null;
}

/* ── Policies (#26–#30, #33, #42, #44, #54, #75) ────────────────────────── */
export interface PasswordPolicy { minLength: number; requireUppercase: boolean; requireLowercase: boolean; requireDigit: boolean; requireSymbol: boolean; expiryDays: number }
export interface SuspiciousLoginPolicy { enabled: boolean; failedAttemptsThreshold: number; windowMinutes: number; alertOnNewAdminIp: boolean; alertEmails: string[] }
export interface GstSlab { code: string; label: string; ratePct: number; appliesTo: string }
export interface DataRetention { auditLogDays: number | null; notificationDays: number | null; gpsPingDays: number | null; webhookDeliveryDays: number | null; otpChallengeDays: number | null }
export interface Policies {
  password: PasswordPolicy; adminIpAllowlist: string[]; suspiciousLogin: SuspiciousLoginPolicy; gstSlabs: GstSlab[];
  agentCredit: { defaultCreditLimitMinor: number; maxCreditLimitMinor: number | null };
  dataRetention: DataRetention; otaRelease: { defaultReleasePct: number };
}

/* ── Role templates (#22–#25) ───────────────────────────────────────────── */
export interface RoleTemplate { id: string; code: string; name: string; description: string | null; permissions: string[]; updatedAt?: string }

/* ── System (#47, #48, #52, #53, #109, #110, #116, #120) ────────────────── */
export interface MaintenanceWindow { id: string; startsAt: string; endsAt: string; message: string; notifiedAt: string | null; cancelledAt: string | null; createdAt: string }
export interface EncryptionStatus { enabled: boolean; currentKeyId: string | null; users: Record<string, number>; integrations: Record<string, number>; remaining: number }

/* ── Operators (#4, #58–#62, #67, #106–#108) ────────────────────────────── */
export interface OperatorDetail {
  id: string; slug: string; displayName: string; legalName: string; status: string; contactEmail: string; contactPhone: string | null;
  primaryDomain: string | null; apiRateLimit: number | null; hasFavicon: boolean; featureOverrides: Record<string, boolean>;
  plan: { id: string; code: string; name: string; features: Record<string, boolean> } | null;
}
export interface RankingRow { tenantId: string; slug: string; displayName: string; rank: number; bookings: number; seats: number; revenueMinor: number; cancelled: number; cancellationRate: number }
export interface Broadcast { id: string; subject: string; body: string; audience: string; recipients: number; sent: number; failed: number; source: string; createdAt: string }

/* ── Bus approvals ──────────────────────────────────────────────────────── */
export interface VehicleQueueRow {
  id: string; registrationNo: string; make: string | null; model: string | null; manufactureYear: number | null;
  verificationStatus: string; verificationReason: string | null; submittedAt: string | null; verifiedAt: string | null; status: string;
  tenantId: string; operatorName: string; operatorSlug: string; pendingDocuments: number;
}
export interface VehicleDocument { id: string; docType: string; documentNo: string | null; validFrom: string | null; expiresOn: string | null; status: string; hasFile: boolean; issuer: string | null; fileName: string | null; rejectionReason: string | null; verifiedAt: string | null }
export interface VehicleReview {
  vehicle: Record<string, unknown> & { id: string; registrationNo: string; verificationStatus: string; verificationReason: string | null; make: string | null; model: string | null; manufactureYear: number | null; status: string };
  documents: VehicleDocument[]; requiredDocTypes: string[]; docLabels: Record<string, string>;
  approvalBlockers: string[];
}

/* ── OTA / GDS partners (#37–#41, #119) ─────────────────────────────────── */
export interface Partner {
  id: string; code: string; name: string; kind: 'ota' | 'agent'; status: 'pending' | 'active' | 'suspended'; statusReason: string | null;
  billingMode: 'prepaid' | 'postpaid'; creditLimitMinor: number; balanceMinor: number; defaultCommissionPct: number;
  contactEmail: string | null; contactPhone: string | null; createdAt: string;
}
export interface PartnerKey { id: string; label: string; prefix: string; sandbox: boolean; ipAllowlist: string[]; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
export interface WebhookTestResult { ok: boolean; responseStatus: number | null; error: string | null; latencyMs: number }
export interface PartnerDetail extends Partner {
  spendableMinor: number; keys: PartnerKey[];
  ledger: { id: string; kind: string; amountMinor: number; balanceAfterMinor: number; reference: string | null; createdAt: string }[];
}

/* ── Billing (#100, #101) ───────────────────────────────────────────────── */
export interface PlatformInvoice { id: string; tenantId: string; invoiceNumber: string; periodFrom: string; periodTo: string; lines: { kind: string; description: string; count: number; baseMinor: number; gstMinor: number }[]; subtotalMinor: number; discountMinor: number; gstMinor: number; totalMinor: number; currency: string; createdAt: string }
export interface PlatformDiscount { id: string; tenantId: string | null; kind: 'percent' | 'flat'; value: number; reason: string; validFrom: string; validTo: string | null; revokedAt: string | null; createdAt: string }

/* ── Health (#90, #91, #111–#113) ───────────────────────────────────────── */
export interface PaymentHealthRow { gateway: string; attempts: number; captured: number; failed: number; abandoned: number; successRate: number }
export interface MessageHealthRow { channel: string; provider: string; total: number; sent: number; failed: number; pending: number; successRate: number }

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.size ? `?${p}` : '';
};

/** The platform admin's own settings and cross-operator controls. */
export const platformAdminApi = {
  integrations: () => get<{ items: Integration[] }>('/v1/admin/integrations'),
  saveIntegration: (provider: string, body: { config: Record<string, unknown>; secrets?: Record<string, unknown> }) =>
    put<Integration>(`/v1/admin/integrations/${provider}`, body),
  enableIntegration: (provider: string, enabled: boolean) => post<Integration>(`/v1/admin/integrations/${provider}/enabled`, { enabled }),
  testIntegration: (provider: string, to?: string) => post<{ ok: boolean; error?: string }>(`/v1/admin/integrations/${provider}/test`, { to: to || undefined }),

  policies: () => get<Policies>('/v1/admin/policies'),
  setPassword: (p: PasswordPolicy) => put<Policies['password']>('/v1/admin/policies/password', p),
  setIpAllowlist: (entries: string[]) => put<{ entries: string[] }>('/v1/admin/policies/admin-ip-allowlist', { entries }),
  setSuspiciousLogin: (p: SuspiciousLoginPolicy) => put<SuspiciousLoginPolicy>('/v1/admin/policies/suspicious-login', p),
  setGstSlabs: (slabs: GstSlab[]) => put<{ slabs: GstSlab[] }>('/v1/admin/policies/gst-slabs', { slabs }),
  setAgentCredit: (p: Policies['agentCredit']) => put<Policies['agentCredit']>('/v1/admin/policies/agent-credit', p),
  setDataRetention: (p: DataRetention) => put<DataRetention>('/v1/admin/policies/data-retention', p),
  setOtaRelease: (defaultReleasePct: number) => put<{ defaultReleasePct: number }>('/v1/admin/policies/ota-release', { defaultReleasePct }),

  roleTemplates: () => get<{ items: RoleTemplate[] }>('/v1/admin/role-templates'),
  createRoleTemplate: (t: { code: string; name: string; description?: string; permissions: string[] }) => post<RoleTemplate>('/v1/admin/role-templates', t),
  updateRoleTemplate: (id: string, t: { name: string; description?: string; permissions: string[] }) => put<RoleTemplate>(`/v1/admin/role-templates/${id}`, t),
  deleteRoleTemplate: (id: string) => del<{ ok: boolean }>(`/v1/admin/role-templates/${id}`),
  /** Every permission an operator role may hold (the operator's catalogue). */
  permissionCatalogue: () => get<{ groups: { group: string; items: { code: string; label: string; grantable: boolean }[] }[] }>('/v1/roles/permissions'),

  maintenance: () => get<{ enabled: boolean; message?: string; until?: string | null }>('/v1/admin/platform/maintenance'),
  setMaintenance: (enabled: boolean, message?: string, until?: string | null) => put<{ enabled: boolean }>('/v1/admin/platform/maintenance', { enabled, message: message || undefined, until: until || undefined }),
  maintenanceWindows: (includePast = false) => get<{ items: MaintenanceWindow[] }>(`/v1/admin/platform/maintenance/windows${includePast ? '?includePast=1' : ''}`),
  scheduleMaintenance: (w: { startsAt: string; endsAt: string; message: string; notifyOperators: boolean }, key: string) =>
    post<{ window: MaintenanceWindow; notified: { sent: number; failed: number } | null }>('/v1/admin/platform/maintenance/windows', w, withIdempotency(key)),
  notifyMaintenance: (id: string) => post<{ sent: number; failed: number }>(`/v1/admin/platform/maintenance/windows/${id}/notify`, {}),
  cancelMaintenance: (id: string) => post<{ ok: boolean }>(`/v1/admin/platform/maintenance/windows/${id}/cancel`, {}),
  cacheNamespaces: () => get<{ namespaces: string[] }>('/v1/admin/platform/cache'),
  /** No namespaces = every cache (idempotency keys and rate limits are never touched). */
  clearCache: (namespaces?: string[]) => post<{ cleared: Record<string, number> }>('/v1/admin/platform/cache/clear', namespaces?.length ? { namespaces } : {}),
  encryption: () => get<EncryptionStatus>('/v1/admin/security/encryption'),
  reencrypt: () => post<EncryptionStatus & { rewritten: number }>('/v1/admin/security/encryption/reencrypt', {}),
  exportAuditLog: (days: 30 | 90) => download(`/v1/admin/tenants/audit-log/export?days=${days}`, `audit-log-${days}d.csv`),

  operator: (id: string) => get<OperatorDetail>(`/v1/admin/tenants/${id}`),
  setDomain: (id: string, domain: string | null) => put<{ primaryDomain: string | null }>(`/v1/admin/tenants/${id}/domain`, { domain }),
  setRateLimit: (id: string, limit: number | null) => put<{ limit: number | null }>(`/v1/admin/tenants/${id}/rate-limit`, { limit }),
  setFavicon: (id: string, dataUri: string | null) => put<{ ok: boolean }>(`/v1/admin/tenants/${id}/favicon`, { dataUri }),
  setFeature: (id: string, feature: string, enabled: boolean | null) => put<{ ok: boolean }>(`/v1/admin/tenants/${id}/features/${feature}`, { enabled }),
  rollbackFeature: (feature: string) => post<{ operatorsAffected: number }>(`/v1/admin/tenants/features/${feature}/rollback`, {}),
  exportOperators: () => download('/v1/admin/tenants/export', 'operators.csv'),
  ranking: (from: string, to: string, sortBy: string) => get<{ from: string; to: string; sortBy: string; items: RankingRow[] }>(`/v1/admin/tenants/ranking${qs({ from, to, sortBy })}`),
  broadcasts: () => get<{ items: Broadcast[] }>('/v1/admin/tenants/broadcasts'),
  broadcast: (b: { subject: string; body: string; audience: string }, key: string) => post<{ id: string; recipients: number; sent: number; failed: number }>('/v1/admin/tenants/broadcasts', b, withIdempotency(key)),

  vehicles: (verification?: string, search?: string) => get<{ items: VehicleQueueRow[] }>(`/v1/admin/vehicles${qs({ verification, search })}`),
  vehicle: (id: string) => get<VehicleReview>(`/v1/admin/vehicles/${id}`),
  /** A short-lived link to a document file (null when storage cannot sign). */
  documentUrl: (id: string, docId: string) => get<{ url: string | null }>(`/v1/admin/vehicles/${id}/documents/${docId}/url`),
  documentFile: (id: string, docId: string) => get<Blob>(`/v1/admin/vehicles/${id}/documents/${docId}/file`, { responseType: 'blob' }),
  verifyDocument: (id: string, docId: string) => post<unknown>(`/v1/admin/vehicles/${id}/documents/${docId}/verify`, {}),
  rejectDocument: (id: string, docId: string, reason: string) => post<unknown>(`/v1/admin/vehicles/${id}/documents/${docId}/reject`, { reason }),
  approveVehicle: (id: string, reason?: string) => post<unknown>(`/v1/admin/vehicles/${id}/approve`, { reason: reason || undefined }),
  rejectVehicle: (id: string, reason: string) => post<unknown>(`/v1/admin/vehicles/${id}/reject`, { reason }),
  suspendVehicle: (id: string, reason: string) => post<unknown>(`/v1/admin/vehicles/${id}/suspend`, { reason }),

  partners: (status?: string) => get<{ items: Partner[] }>(`/v1/admin/gds/partners${qs({ status })}`),
  partner: (id: string) => get<PartnerDetail>(`/v1/admin/gds/partners/${id}`),
  createPartner: (p: { code: string; name: string; kind: string; billingMode: string; creditLimitMinor: number; defaultCommissionPct: number; contactEmail?: string; contactPhone?: string }, key: string) =>
    post<{ id: string }>('/v1/admin/gds/partners', p, withIdempotency(key)),
  setPartnerStatus: (id: string, status: 'active' | 'suspended', reason?: string) => post<{ ok: boolean }>(`/v1/admin/gds/partners/${id}/status`, { status, reason: reason || undefined }),
  setPartnerTerms: (id: string, t: { billingMode?: string; creditLimitMinor?: number; defaultCommissionPct?: number }) => put<{ ok: boolean }>(`/v1/admin/gds/partners/${id}/terms`, t),
  partnerReceipt: (id: string, r: { amountMinor: number; reference: string }, key: string) => post<{ applied: boolean }>(`/v1/admin/gds/partners/${id}/receipts`, r, withIdempotency(key)),
  issuePartnerKey: (id: string, k: { label: string; sandbox: boolean; ipAllowlist: string[]; expiresInDays?: number }) => post<{ id: string; key: string; note: string }>(`/v1/admin/gds/partners/${id}/keys`, k),
  revokePartnerKey: (id: string, keyId: string) => del<{ ok: boolean }>(`/v1/admin/gds/partners/${id}/keys/${keyId}`),
  partnerWebhook: (id: string) => get<{ endpoint: { id: string; url: string; eventTypes: string[]; active?: boolean } | null; deliveries: { id: string; eventType: string; status: string; responseStatus: number | null; createdAt: string }[] }>(`/v1/admin/gds/partners/${id}/webhook`),
  setPartnerWebhook: (id: string, w: { url: string; eventTypes: string[] }) => put<{ id: string; secret: string }>(`/v1/admin/gds/partners/${id}/webhook`, w),
  removePartnerWebhook: (id: string) => del<{ ok: boolean }>(`/v1/admin/gds/partners/${id}/webhook`),
  testPartnerWebhook: (id: string) => post<WebhookTestResult>(`/v1/admin/gds/partners/${id}/webhook/test`, {}),

  invoices: (tenantId?: string) => get<{ items: PlatformInvoice[] }>(`/v1/admin/billing/invoices${qs({ tenantId })}`),
  invoice: (id: string) => get<PlatformInvoice>(`/v1/admin/billing/invoices/${id}`),
  generateInvoice: (b: { tenantId: string; from: string; to: string }, key: string) => post<{ invoice: PlatformInvoice; created: boolean }>('/v1/admin/billing/invoices', b, withIdempotency(key)),
  discounts: (tenantId?: string) => get<{ items: PlatformDiscount[] }>(`/v1/admin/billing/discounts${qs({ tenantId })}`),
  createDiscount: (d: { tenantId: string | null; kind: 'percent' | 'flat'; value: number; reason: string; validFrom: string; validTo: string | null }) => post<PlatformDiscount>('/v1/admin/billing/discounts', d),
  revokeDiscount: (id: string) => del<{ ok: boolean }>(`/v1/admin/billing/discounts/${id}`),

  paymentHealth: (from: string, to: string) => get<{ items: PaymentHealthRow[] }>(`/v1/admin/monitoring/payments${qs({ from, to })}`),
  messageHealth: (from: string, to: string) => get<{ items: MessageHealthRow[] }>(`/v1/admin/monitoring/messages${qs({ from, to })}`),
};
