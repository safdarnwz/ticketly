import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import { requireTenantId, type TenantId, type Uuid } from '@kernel';

import { Tenant, type TenantProps, type TenantStatus } from '../../domain/tenant.entity';

registerConstraintMessages({
  tenants_slug_key: 'An operator with this slug already exists',
  tenants_primary_domain_key: 'This domain is already claimed by another operator',
});

interface TenantRow {
  id: TenantId;
  slug: string;
  legal_name: string;
  display_name: string;
  status: TenantStatus;
  plan_id: Uuid | null;
  primary_domain: string | null;
  contact_email: string;
  contact_phone: string | null;
  timezone: string;
  currency: string;
  locale: string;
  settings: Record<string, unknown>;
  feature_overrides: Record<string, unknown>;
  suspended_reason: string | null;
  version: number;
  created_at: Date;
}

/**
 * Tenant repository.
 *
 * This is the ONE repository in the platform that operates OUTSIDE the normal
 * tenant scope, because tenant resolution needs to look a tenant up *before* a
 * tenant is bound. It therefore runs with `bypassRls` on the read paths and is
 * only reachable from the resolution middleware and the platform-admin module —
 * never from tenant-scoped feature code.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly db: DatabaseService) {}

  private static readonly COLUMNS = `
    id, slug, legal_name, display_name, status, plan_id, primary_domain,
    contact_email, contact_phone, timezone, currency, locale,
    settings, feature_overrides, suspended_reason, version, created_at`;

  async findById(id: TenantId): Promise<Tenant | null> {
    const row = await this.db.queryOne<TenantRow>(
      `SELECT ${TenantRepository.COLUMNS} FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [id],
      { name: 'tenant.findById', primary: true },
    );
    return row ? this.toDomain(row) : null;
  }

  /** Resolve by slug or verified custom domain — used by the resolver. Cached upstream. */
  /** Bank account (for payouts), GSTIN and registered address (for tax invoices). */
  async setBusinessDetails(
    tenantId: string,
    d: {
      bank: {
        holder: string | null;
        accountNumber: string | null;
        ifsc: string | null;
        name: string | null;
      };
      gstin: string | null;
      registeredAddress: string | null;
    },
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE tenants SET bank_account_holder = $2, bank_account_number = $3, bank_ifsc = $4,
              bank_name = $5,
              bank_details_updated_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE NULL END,
              gstin = $6, registered_address = $7, updated_at = now()
        WHERE id = $1`,
      [
        tenantId,
        d.bank.holder,
        d.bank.accountNumber,
        d.bank.ifsc,
        d.bank.name,
        d.gstin,
        d.registeredAddress,
      ],
      { name: 'tenant.setBusinessDetails', primary: true },
    );
  }

  async displayName(tenantId: string): Promise<string | null> {
    const row = await this.db.queryOne<{ display_name: string }>(
      `SELECT display_name FROM tenants WHERE id = $1`,
      [tenantId],
      { name: 'tenant.displayName', primary: true },
    );
    return row?.display_name ?? null;
  }

  async findBySlugOrDomain(value: string): Promise<Tenant | null> {
    const normalised = value.trim().toLowerCase();
    const row = await this.db.queryOne<TenantRow>(
      `SELECT ${TenantRepository.COLUMNS} FROM tenants
        WHERE (lower(slug) = $1 OR lower(primary_domain) = $1) AND deleted_at IS NULL
        LIMIT 1`,
      [normalised],
      { name: 'tenant.findBySlugOrDomain', primary: true },
    );
    return row ? this.toDomain(row) : null;
  }

  async insert(tenant: Tenant): Promise<void> {
    const p = tenant.snapshot();
    await this.db.execute_(
      `INSERT INTO tenants
         (id, slug, legal_name, display_name, status, plan_id, primary_domain,
          contact_email, contact_phone, timezone, currency, locale,
          settings, feature_overrides, suspended_reason, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        tenant.id,
        p.slug,
        p.legalName,
        p.displayName,
        p.status,
        p.planId,
        p.primaryDomain,
        p.contactEmail,
        p.contactPhone,
        p.timezone,
        p.currency,
        p.locale,
        JSON.stringify(p.settings),
        JSON.stringify(p.featureOverrides),
        p.suspendedReason,
        tenant.version,
        p.createdAt,
      ],
      { name: 'tenant.insert', primary: true },
    );
  }

  /** Optimistic-locked update. Returns false when the version moved underneath us. */
  async update(tenant: Tenant, expectedVersion: number): Promise<boolean> {
    const p = tenant.snapshot();
    const affected = await this.db.execute_(
      `UPDATE tenants SET
         legal_name=$2, display_name=$3, status=$4, plan_id=$5, primary_domain=$6,
         contact_email=$7, contact_phone=$8, timezone=$9, currency=$10, locale=$11,
         settings=$12, feature_overrides=$13, suspended_reason=$14,
         version = version + 1, updated_at = now()
       WHERE id=$1 AND version=$15 AND deleted_at IS NULL`,
      [
        tenant.id,
        p.legalName,
        p.displayName,
        p.status,
        p.planId,
        p.primaryDomain,
        p.contactEmail,
        p.contactPhone,
        p.timezone,
        p.currency,
        p.locale,
        JSON.stringify(p.settings),
        JSON.stringify(p.featureOverrides),
        p.suspendedReason,
        expectedVersion,
      ],
      { name: 'tenant.update', primary: true },
    );
    return affected > 0;
  }

  async listActiveIds(): Promise<TenantId[]> {
    const rows = await this.db.query<{ id: TenantId }>(
      `SELECT id FROM tenants WHERE status = 'active' AND deleted_at IS NULL ORDER BY id`,
      [],
      { name: 'tenant.listActiveIds', primary: true },
    );
    return rows.map((r) => r.id);
  }

  /** Platform-admin listing — every operator, newest first. Not tenant-scoped by design. */
  async list(): Promise<
    Array<{
      id: TenantId;
      slug: string;
      displayName: string;
      status: TenantStatus;
      contactEmail: string;
      suspendedReason: string | null;
      createdAt: Date;
    }>
  > {
    return this.db.query(
      `SELECT id, slug, display_name AS "displayName", status, contact_email AS "contactEmail",
              suspended_reason AS "suspendedReason", created_at AS "createdAt"
         FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 500`,
      [],
      { name: 'tenant.list', primary: true },
    );
  }

  /**
   * One operator for the platform admin's settings panel: plan (with its
   * features), the operator's own feature overrides, custom domain, API rate
   * limit and whether a favicon is set. Null when unknown.
   */
  async adminDetail(id: string): Promise<{
    id: string;
    slug: string;
    displayName: string;
    legalName: string;
    status: string;
    contactEmail: string;
    contactPhone: string | null;
    primaryDomain: string | null;
    apiRateLimit: number | null;
    hasFavicon: boolean;
    featureOverrides: Record<string, boolean>;
    plan: { id: string; code: string; name: string; features: Record<string, boolean> } | null;
  } | null> {
    return this.db.queryOne(
      `SELECT t.id, t.slug, t.display_name AS "displayName", t.legal_name AS "legalName", t.status,
              t.contact_email AS "contactEmail", t.contact_phone AS "contactPhone",
              t.primary_domain AS "primaryDomain", t.api_rate_limit AS "apiRateLimit",
              (t.settings->>'faviconUrl') IS NOT NULL AS "hasFavicon",
              coalesce(t.feature_overrides, '{}'::jsonb) AS "featureOverrides",
              CASE WHEN p.id IS NULL THEN NULL
                   ELSE jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name,
                                           'features', coalesce(p.features, '{}'::jsonb)) END AS plan
         FROM tenants t
         LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.id = $1 AND t.deleted_at IS NULL`,
      [id],
      { name: 'tenant.adminDetail', primary: true },
    );
  }

  /** Every operator with its plan and contact details — the platform export (#107). */
  async listForExport(): Promise<Record<string, unknown>[]> {
    return this.db.query(
      `SELECT t.id, t.slug, t.display_name AS "displayName", t.legal_name AS "legalName", t.status,
              p.code AS plan, t.contact_email AS "contactEmail", t.contact_phone AS "contactPhone",
              t.primary_domain AS "customDomain", t.gstin, t.suspended_reason AS "suspendedReason",
              t.suspended_at AS "suspendedAt", t.created_at AS "createdAt"
         FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id
        WHERE t.deleted_at IS NULL ORDER BY t.created_at`,
      [],
      { name: 'tenant.listForExport', primary: true },
    );
  }

  /** Set (true/false) or clear (null) one per-operator feature override. */
  async setFeatureOverride(
    tenantId: string,
    feature: string,
    enabled: boolean | null,
  ): Promise<boolean> {
    const n = await this.db.execute_(
      enabled === null
        ? `UPDATE tenants SET feature_overrides = feature_overrides - $2 WHERE id = $1`
        : `UPDATE tenants SET feature_overrides = feature_overrides || jsonb_build_object($2::text, $3::boolean) WHERE id = $1`,
      enabled === null ? [tenantId, feature] : [tenantId, feature, enabled],
      { name: 'tenant.setFeatureOverride', primary: true },
    );
    return n > 0;
  }

  /** Global rollback: remove one feature's override from EVERY operator. Returns affected tenant ids. */
  async clearFeatureEverywhere(feature: string): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE tenants SET feature_overrides = feature_overrides - $1 WHERE feature_overrides ? $1 RETURNING id`,
      [feature],
      { name: 'tenant.clearFeature', primary: true },
    );
    return rows.map((r) => r.id);
  }

  async changePlan(tenantId: string, planId: string): Promise<void> {
    await this.db.execute_(`UPDATE tenants SET plan_id = $2 WHERE id = $1`, [tenantId, planId], {
      name: 'tenant.changePlan',
      primary: true,
    });
  }

  /** Platform-wide counts by status — for the super-admin analytics dashboard. */
  async countsByStatus(): Promise<{ active: number; suspended: number; total: number }> {
    const row = await this.db.queryOne<{ active: string; suspended: string; total: string }>(
      `SELECT count(*) FILTER (WHERE status = 'active') AS active,
              count(*) FILTER (WHERE status = 'suspended') AS suspended,
              count(*) AS total
         FROM tenants WHERE deleted_at IS NULL`,
      [],
      { name: 'tenant.countsByStatus', primary: true },
    );
    return {
      active: Number(row?.active ?? 0),
      suspended: Number(row?.suspended ?? 0),
      total: Number(row?.total ?? 0),
    };
  }

  private toDomain(row: TenantRow): Tenant {
    const props: TenantProps = {
      slug: row.slug,
      legalName: row.legal_name,
      displayName: row.display_name,
      status: row.status,
      planId: row.plan_id,
      primaryDomain: row.primary_domain,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      timezone: row.timezone,
      currency: row.currency,
      locale: row.locale,
      settings: row.settings as Record<string, never>,
      featureOverrides: row.feature_overrides as Record<string, never>,
      suspendedReason: row.suspended_reason,
      createdAt: row.created_at,
    };
    return Tenant.rehydrate(row.id, props, row.version);
  }

  /**
   * The ACTIVE payout account — only ever written by onboarding approval
   * (the initial account, vetted as part of the whole application review) or
   * PayoutRepository.approveBankChange (a later change, only after platform
   * review). There is deliberately NO direct "just update it" method here
   * anymore — an operator changing their own account without a human
   * reviewing it first is exactly the anti-fraud gap this closes.
   */
  async getBankDetails(tenantId?: string): Promise<{
    accountHolder: string | null;
    accountNumber: string | null;
    ifsc: string | null;
    bankName: string | null;
    updatedAt: Date | null;
  } | null> {
    const row = await this.db.queryOne<{
      bank_account_holder: string | null;
      bank_account_number: string | null;
      bank_ifsc: string | null;
      bank_name: string | null;
      bank_details_updated_at: Date | null;
    }>(
      `SELECT bank_account_holder, bank_account_number, bank_ifsc, bank_name, bank_details_updated_at FROM tenants WHERE id = $1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.getBankDetails', primary: true },
    );
    if (!row) return null;
    return {
      accountHolder: row.bank_account_holder,
      accountNumber: row.bank_account_number,
      ifsc: row.bank_ifsc,
      bankName: row.bank_name,
      updatedAt: row.bank_details_updated_at,
    };
  }

  /** Contacts and address the operator keeps up to date themselves (plus the verified legal details). */
  async contactDetails(tenantId?: string): Promise<{
    contactEmail: string;
    contactPhone: string | null;
    secondaryContact: { name: string; phone: string; email?: string } | null;
    address: { line1: string; line2?: string; city: string; state: string; pincode: string } | null;
    registeredAddress: string | null;
    legalName: string;
    gstin: string | null;
  } | null> {
    return this.db.queryOne(
      `SELECT contact_email AS "contactEmail", contact_phone AS "contactPhone",
              settings->'secondaryContact' AS "secondaryContact", settings->'address' AS address,
              registered_address AS "registeredAddress", legal_name AS "legalName", gstin
         FROM tenants WHERE id = $1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.contactDetails', primary: true },
    );
  }

  /** Second contact (null removes) and the structured address, which is also the invoice address. */
  async setContactExtras(input: {
    secondaryContact?: { name: string; phone: string; email?: string } | null;
    address?: { line1: string; line2?: string; city: string; state: string; pincode: string };
  }): Promise<void> {
    const a = input.address;
    await this.db.execute_(
      `UPDATE tenants SET
         settings = CASE WHEN $2::boolean THEN
                      (CASE WHEN $3::jsonb IS NULL THEN settings - 'secondaryContact'
                            ELSE settings || jsonb_build_object('secondaryContact', $3::jsonb) END)
                    ELSE settings END
                    || CASE WHEN $4::jsonb IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('address', $4::jsonb) END,
         registered_address = coalesce($5, registered_address),
         version = version + 1
       WHERE id = $1`,
      [
        requireTenantId(),
        input.secondaryContact !== undefined,
        input.secondaryContact ? JSON.stringify(input.secondaryContact) : null,
        a ? JSON.stringify(a) : null,
        a
          ? [a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).join(', ')
          : null,
      ],
      { name: 'tenant.setContactExtras', primary: true },
    );
  }

  /** Whether this operator has sold anything yet (currency can only change before that). */
  async hasBookings(tenantId?: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM bookings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.hasBookings', primary: true },
    );
    return !!row;
  }

  /** GSTIN + registered address + legal name for tax-invoice/e-ticket issuance (CGST Rule 46 mandatory supplier fields) — see migration 0036. */
  async getGstDetails(
    tenantId?: string,
  ): Promise<{ legalName: string; gstin: string | null; registeredAddress: string | null } | null> {
    const row = await this.db.queryOne<{
      legal_name: string;
      gstin: string | null;
      registered_address: string | null;
    }>(
      `SELECT legal_name, gstin, registered_address FROM tenants WHERE id = $1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.getGstDetails', primary: true },
    );
    return row
      ? { legalName: row.legal_name, gstin: row.gstin, registeredAddress: row.registered_address }
      : null;
  }

  /**
   * Logo shown on this operator's e-tickets, GST invoices, and (once a
   * per-tenant email display-name is wired — see Mailer/NotificationService)
   * anywhere else their own branding belongs instead of the platform's.
   * Stored in tenants.settings (the schemaless "branding, GST number,
   * invoice prefix" JSONB column — see migration 0002's own comment) as a
   * data: URI, not a dedicated column or object-storage upload — this
   * platform has no file-storage service to upload TO, and a data: URI
   * needs neither one nor a CDN to just work everywhere the logo is used
   * (HTML e-tickets, PDF invoices) at the modest size a logo actually is.
   */
  /** Assign (or clear, with null) an operator's custom domain (#4). Returns the previous one. */
  async setPrimaryDomain(
    tenantId: string,
    domain: string | null,
  ): Promise<{ previous: string | null } | null> {
    const row = await this.db.queryOne<{ previous: string | null }>(
      `UPDATE tenants t SET primary_domain = $2, version = t.version + 1
         FROM (SELECT primary_domain AS previous FROM tenants WHERE id = $1) old
        WHERE t.id = $1 AND t.deleted_at IS NULL
        RETURNING old.previous`,
      [tenantId, domain],
      { name: 'tenant.setPrimaryDomain', primary: true },
    );
    return row ?? null;
  }

  /** Per-operator API rate limit (#62): requests per rate-limit window, null = platform default. */
  async apiRateLimit(tenantId: string): Promise<number | null> {
    const row = await this.db.queryOne<{ api_rate_limit: number | null }>(
      `SELECT api_rate_limit FROM tenants WHERE id = $1`,
      [tenantId],
      { name: 'tenant.apiRateLimit' },
    );
    return row?.api_rate_limit ?? null;
  }

  async setApiRateLimit(tenantId: string, limit: number | null): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE tenants SET api_rate_limit = $2, version = version + 1 WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId, limit],
      { name: 'tenant.setApiRateLimit', primary: true },
    );
    return n > 0;
  }

  /** White-label favicon (#67), a small data URI; null removes it. */
  async setFavicon(tenantId: string, dataUri: string | null): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE tenants SET settings = CASE WHEN $2::text IS NULL THEN settings - 'faviconUrl'
                                          ELSE jsonb_set(settings, '{faviconUrl}', to_jsonb($2::text)) END,
              version = version + 1
        WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId, dataUri],
      { name: 'tenant.setFavicon', primary: true },
    );
    return n > 0;
  }

  /** What a customer-facing site needs to brand itself as this operator. */
  async branding(tenantId: string): Promise<{
    displayName: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryDomain: string | null;
  } | null> {
    return this.db.queryOne(
      `SELECT display_name AS "displayName",
              coalesce(settings->>'logoCdnUrl', settings->>'logoUrl') AS "logoUrl",
              settings->>'faviconUrl' AS "faviconUrl",
              primary_domain AS "primaryDomain"
         FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
      { name: 'tenant.branding' },
    );
  }

  async getLogoUrl(tenantId?: string): Promise<string | null> {
    const row = await this.db.queryOne<{ logo_url: string | null }>(
      `SELECT settings->>'logoUrl' AS logo_url FROM tenants WHERE id = $1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.getLogoUrl', primary: true },
    );
    return row?.logo_url ?? null;
  }

  async setLogoUrl(dataUri: string): Promise<void> {
    await this.db.execute_(
      `UPDATE tenants SET settings = jsonb_set(settings, '{logoUrl}', to_jsonb($2::text)), version = version + 1 WHERE id = $1`,
      [requireTenantId(), dataUri],
      { name: 'tenant.setLogoUrl', primary: true },
    );
  }

  async setLogoFile(input: {
    fileId: string;
    objectKey: string;
    url: string | null;
  }): Promise<void> {
    await this.db.execute_(
      `UPDATE tenants SET settings = settings || jsonb_build_object('logoFileId', $2::text, 'logoObjectKey', $3::text, 'logoCdnUrl', $4::text),
              version = version + 1 WHERE id = $1`,
      [requireTenantId(), input.fileId, input.objectKey, input.url],
      { name: 'tenant.setLogoFile', primary: true },
    );
  }

  /**
   * The prefix on this operator's own GST invoices/credit-notes — e.g.
   * "SPB" for Shyamoli Paribahan giving "SPB/2026-27/000042", instead of
   * every single operator on the platform showing the same generic "INV"
   * prefix regardless of their own business identity. Falls back to
   * 'INV' (tax invoices) / 'CRN' (credit notes) when never set — the SAME
   * defaults InvoiceService always used before this existed, so an
   * operator who never touches this setting sees no change at all.
   */
  async getInvoicePrefix(tenantId?: string): Promise<string | null> {
    const row = await this.db.queryOne<{ prefix: string | null }>(
      `SELECT settings->>'invoicePrefix' AS prefix FROM tenants WHERE id = $1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.getInvoicePrefix', primary: true },
    );
    return row?.prefix ?? null;
  }

  /** This operator's rule for connections that change onto its buses, or null (platform default). */
  async getConnectionRules(): Promise<unknown> {
    const row = await this.db.queryOne<{ rules: unknown }>(
      `SELECT settings->'connections' AS rules FROM tenants WHERE id = $1`,
      [requireTenantId()],
      { name: 'tenant.getConnectionRules', primary: true },
    );
    return row?.rules ?? null;
  }

  async setConnectionRules(rules: object | null): Promise<void> {
    await this.db.execute_(
      `UPDATE tenants SET settings = CASE WHEN $2::jsonb IS NULL THEN settings - 'connections'
                                          ELSE jsonb_set(settings, '{connections}', $2::jsonb) END,
              version = version + 1 WHERE id = $1`,
      [requireTenantId(), rules ? JSON.stringify(rules) : null],
      { name: 'tenant.setConnectionRules', primary: true },
    );
  }

  async setInvoicePrefix(prefix: string): Promise<void> {
    await this.db.execute_(
      `UPDATE tenants SET settings = jsonb_set(settings, '{invoicePrefix}', to_jsonb($2::text)), version = version + 1 WHERE id = $1`,
      [requireTenantId(), prefix],
      { name: 'tenant.setInvoicePrefix', primary: true },
    );
  }

  /**
   * This operator's own cancellation/refund tiers, or null if they've never
   * set one (BookingService.cancel() falls back to DEFAULT_REFUND_POLICY in
   * that case — see migration 0037's own comment for why this exists at all).
   */
  async getRefundPolicy(tenantId?: string): Promise<unknown> {
    const row = await this.db.queryOne<{ refund_policy: unknown }>(
      `SELECT refund_policy FROM tenants WHERE id = $1`,
      [tenantId ?? requireTenantId()],
      { name: 'tenant.getRefundPolicy', primary: true },
    );
    return row?.refund_policy ?? null;
  }

  /** Pass `null` to revert to the platform default. */
  async setRefundPolicy(policy: unknown, tenantId?: string): Promise<void> {
    await this.db.execute_(
      `UPDATE tenants SET refund_policy = $2, updated_at = now() WHERE id = $1`,
      [tenantId ?? requireTenantId(), policy === null ? null : JSON.stringify(policy)],
      { name: 'tenant.setRefundPolicy', primary: true },
    );
  }
}
