import { Injectable } from '@nestjs/common';

import { currentTransaction, registerConstraintMessages, UnitOfWork } from '@database';
import { newId, requireTenantId, type BookingId } from '@kernel';

import { signedAmount, type AgentLedgerKind } from '../../agents/domain/agent-account';

registerConstraintMessages({
  gds_partners_code_key: 'A GDS partner with this code already exists',
  gds_partners_spend_within_limit: 'This would take the partner past its credit limit',
});

export interface GdsPartner {
  id: string;
  code: string;
  name: string;
  kind: 'ota' | 'agent';
  status: 'pending' | 'active' | 'suspended';
  statusReason: string | null;
  billingMode: 'prepaid' | 'postpaid';
  creditLimitMinor: number;
  balanceMinor: number;
  defaultCommissionPct: number;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: Date;
}
const COLS = `id, code, name, kind, status, status_reason, billing_mode, credit_limit_minor, balance_minor, default_commission_pct,
  contact_email, contact_phone, created_at`;
interface Row {
  id: string;
  code: string;
  name: string;
  kind: 'ota' | 'agent';
  status: GdsPartner['status'];
  status_reason: string | null;
  billing_mode: GdsPartner['billingMode'];
  credit_limit_minor: string;
  balance_minor: string;
  default_commission_pct: string;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: Date;
}
const map = (r: Row): GdsPartner => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind,
  status: r.status,
  statusReason: r.status_reason,
  billingMode: r.billing_mode,
  creditLimitMinor: Number(r.credit_limit_minor),
  balanceMinor: Number(r.balance_minor),
  defaultCommissionPct: Number(r.default_commission_pct),
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  createdAt: r.created_at,
});

/**
 * GDS persistence. Partner tables are PLATFORM-level (no tenant). Reads that
 * span operators (agreements, which operator owns a trip/booking) run with
 * RLS bypassed and return only ids/terms — the actual booking work always
 * runs inside the owning operator's tenant context.
 */
@Injectable()
export class GdsRepository {
  constructor(private readonly uow: UnitOfWork) {}

  private run<T>(
    name: string,
    fn: (q: <R = unknown>(sql: string, params: unknown[]) => Promise<R[]>) => Promise<T>,
    bypass = true,
  ): Promise<T> {
    const tx = currentTransaction();
    const exec = async <R>(
      client: { query: (s: string, p: unknown[]) => Promise<{ rows: unknown[] }> },
      sql: string,
      params: unknown[],
    ) => (await client.query(sql, params)).rows as R[];
    if (tx) return fn((sql, params) => exec(tx.client as never, sql, params));
    return this.uow.run({ name, bypassRls: bypass }, async (scope) =>
      fn((sql, params) => exec(scope.client as never, sql, params)),
    );
  }

  /* ── partners ── */
  async createPartner(i: {
    code: string;
    name: string;
    kind: 'ota' | 'agent';
    billingMode: 'prepaid' | 'postpaid';
    creditLimitMinor: number;
    defaultCommissionPct: number;
    contactEmail?: string;
    contactPhone?: string;
    gstin?: string;
  }): Promise<string> {
    const id = newId();
    await this.run('gds.createPartner', (q) =>
      q(
        `INSERT INTO gds_partners (id, code, name, kind, billing_mode, credit_limit_minor, default_commission_pct, contact_email, contact_phone, gstin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id,
          i.code,
          i.name,
          i.kind,
          i.billingMode,
          i.billingMode === 'prepaid' ? 0 : i.creditLimitMinor,
          i.defaultCommissionPct,
          i.contactEmail ?? null,
          i.contactPhone ?? null,
          i.gstin ?? null,
        ],
      ),
    );
    return id;
  }
  async listPartners(status?: string): Promise<GdsPartner[]> {
    return (
      await this.run('gds.listPartners', (q) =>
        q<Row>(
          `SELECT ${COLS} FROM gds_partners WHERE ($1::text IS NULL OR status = $1) ORDER BY name`,
          [status ?? null],
        ),
      )
    ).map(map);
  }
  async getPartner(id: string, forUpdate = false): Promise<GdsPartner | null> {
    const r = await this.run('gds.getPartner', (q) =>
      q<Row>(`SELECT ${COLS} FROM gds_partners WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [
        id,
      ]),
    );
    return r[0] ? map(r[0]) : null;
  }
  async updatePartner(
    id: string,
    i: {
      status?: string;
      statusReason?: string | null;
      billingMode?: string;
      creditLimitMinor?: number;
      defaultCommissionPct?: number;
    },
  ): Promise<void> {
    await this.run('gds.updatePartner', (q) =>
      q(
        `UPDATE gds_partners SET status = coalesce($2, status), status_reason = CASE WHEN $2::text IS NULL THEN status_reason ELSE $3 END,
              billing_mode = coalesce($4, billing_mode), credit_limit_minor = coalesce($5, credit_limit_minor),
              default_commission_pct = coalesce($6, default_commission_pct)
        WHERE id = $1`,
        [
          id,
          i.status ?? null,
          i.statusReason ?? null,
          i.billingMode ?? null,
          i.creditLimitMinor ?? null,
          i.defaultCommissionPct ?? null,
        ],
      ),
    );
  }

  /* ── keys ── */
  async createKey(i: {
    partnerId: string;
    label: string;
    prefix: string;
    hash: string;
    sandbox: boolean;
    ipAllowlist: string[];
    expiresAt: Date | null;
  }): Promise<string> {
    const id = newId();
    await this.run('gds.createKey', (q) =>
      q(
        `INSERT INTO gds_partner_keys (id, partner_id, label, prefix, key_hash, sandbox, ip_allowlist, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7::cidr[],$8)`,
        [id, i.partnerId, i.label, i.prefix, i.hash, i.sandbox, i.ipAllowlist, i.expiresAt],
      ),
    );
    return id;
  }
  async keyByPrefix(prefix: string): Promise<{
    id: string;
    partnerId: string;
    hash: string;
    sandbox: boolean;
    ipAllowlist: string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
  } | null> {
    const r = await this.run('gds.keyByPrefix', (q) =>
      q<{
        id: string;
        partner_id: string;
        key_hash: string;
        sandbox: boolean;
        ip_allowlist: string[];
        expires_at: Date | null;
        revoked_at: Date | null;
      }>(
        `SELECT id, partner_id, key_hash, sandbox, ip_allowlist::text[] AS ip_allowlist, expires_at, revoked_at FROM gds_partner_keys WHERE prefix = $1`,
        [prefix],
      ),
    );
    const k = r[0];
    return k
      ? {
          id: k.id,
          partnerId: k.partner_id,
          hash: k.key_hash,
          sandbox: k.sandbox,
          ipAllowlist: k.ip_allowlist ?? [],
          expiresAt: k.expires_at,
          revokedAt: k.revoked_at,
        }
      : null;
  }
  async listKeys(partnerId: string) {
    return this.run('gds.listKeys', (q) =>
      q(
        `SELECT id, label, prefix, sandbox, ip_allowlist::text[] AS "ipAllowlist", expires_at AS "expiresAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt", created_at AS "createdAt"
         FROM gds_partner_keys WHERE partner_id = $1 ORDER BY created_at DESC`,
        [partnerId],
      ),
    );
  }
  async revokeKey(partnerId: string, keyId: string): Promise<boolean> {
    const r = await this.run('gds.revokeKey', (q) =>
      q(
        `UPDATE gds_partner_keys SET revoked_at = now() WHERE id = $1 AND partner_id = $2 AND revoked_at IS NULL RETURNING id`,
        [keyId, partnerId],
      ),
    );
    return r.length > 0;
  }
  async touchKey(keyId: string): Promise<void> {
    await this.run('gds.touchKey', (q) =>
      q(
        `UPDATE gds_partner_keys SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`,
        [keyId],
      ),
    );
  }

  /* ── ledger (idempotent per partner+kind+reference; caller holds the partner row lock) ── */
  async post(i: {
    partnerId: string;
    kind: AgentLedgerKind;
    magnitudeMinor: number;
    tenantId?: string | null;
    bookingId?: string | null;
    reference?: string | null;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<{ applied: boolean }> {
    const amount = signedAmount(i.kind, i.magnitudeMinor);
    return this.run('gds.post', async (q) => {
      const id = newId();
      const ins = await q<{ id: string }>(
        `INSERT INTO gds_partner_ledger (id, partner_id, kind, amount_minor, balance_after_minor, tenant_id, booking_id, reference, note, created_by)
         VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9) ON CONFLICT (partner_id, kind, reference) WHERE reference IS NOT NULL DO NOTHING RETURNING id`,
        [
          id,
          i.partnerId,
          i.kind,
          amount,
          i.tenantId ?? null,
          i.bookingId ?? null,
          i.reference ?? null,
          i.note ?? null,
          i.createdBy ?? null,
        ],
      );
      if (!ins.length) return { applied: false };
      const bal = await q<{ balance_minor: string }>(
        `UPDATE gds_partners SET balance_minor = balance_minor + $2 WHERE id = $1 RETURNING balance_minor`,
        [i.partnerId, amount],
      );
      await q(`UPDATE gds_partner_ledger SET balance_after_minor = $2 WHERE id = $1`, [
        id,
        Number(bal[0]?.balance_minor ?? 0),
      ]);
      return { applied: true };
    });
  }
  async ledger(partnerId: string, limit = 200) {
    return this.run('gds.ledger', (q) =>
      q(
        `SELECT l.id, l.kind, l.amount_minor::bigint AS "amountMinor", l.balance_after_minor::bigint AS "balanceAfterMinor", l.reference, l.note, l.created_at AS "createdAt",
              b.pnr, t.display_name AS "operatorName"
         FROM gds_partner_ledger l LEFT JOIN bookings b ON b.id = l.booking_id LEFT JOIN tenants t ON t.id = l.tenant_id
        WHERE l.partner_id = $1 ORDER BY l.created_at DESC LIMIT $2`,
        [partnerId, Math.min(limit, 1000)],
      ),
    );
  }
  /** The original sale for a booking: ticket value debited and commission credited, plus commission still un-reversed. */
  async saleFigures(
    partnerId: string,
    bookingId: string,
  ): Promise<{ saleMinor: number; commissionMinor: number; remainingCommissionMinor: number }> {
    const r = await this.run('gds.saleFigures', (q) =>
      q<{ sale: string; commission: string; remaining: string }>(
        `SELECT coalesce(-sum(amount_minor) FILTER (WHERE kind = 'booking_debit'), 0) - coalesce(sum(amount_minor) FILTER (WHERE kind = 'booking_reversal'), 0) AS sale,
              coalesce(sum(amount_minor) FILTER (WHERE kind = 'commission_credit'), 0) AS commission,
              coalesce(sum(amount_minor) FILTER (WHERE kind IN ('commission_credit', 'commission_reversal')), 0) AS remaining
         FROM gds_partner_ledger WHERE partner_id = $1 AND booking_id = $2`,
        [partnerId, bookingId],
      ),
    );
    return {
      saleMinor: Number(r[0]?.sale ?? 0),
      commissionMinor: Number(r[0]?.commission ?? 0),
      remainingCommissionMinor: Math.max(0, Number(r[0]?.remaining ?? 0)),
    };
  }

  /* ── cross-operator lookups (ids / terms only) ── */
  async agreementsFor(partnerId: string): Promise<Map<string, number>> {
    const r = await this.run('gds.agreementsFor', (q) =>
      q<{ tenant_id: string; commission_pct: string }>(
        `SELECT a.tenant_id, a.commission_pct FROM gds_agreements a JOIN tenants t ON t.id = a.tenant_id AND t.status = 'active'
        WHERE a.partner_id = $1 AND a.status = 'active'`,
        [partnerId],
      ),
    );
    return new Map(r.map((x) => [x.tenant_id, Number(x.commission_pct)]));
  }
  async tripOwner(tripId: string): Promise<{ tenantId: string; closed: string[] } | null> {
    const r = await this.run('gds.tripOwner', (q) =>
      q<{ tenant_id: string; closed: string[] }>(
        `SELECT t.tenant_id, array(SELECT DISTINCT unnest(t.closed_channels || coalesce(s.closed_channels, '{}'))) AS closed
         FROM trips t LEFT JOIN services s ON s.id = t.service_id WHERE t.id = $1`,
        [tripId],
      ),
    );
    return r[0] ? { tenantId: r[0].tenant_id, closed: r[0].closed ?? [] } : null;
  }
  async tripsClosedForOta(tripIds: string[]): Promise<Set<string>> {
    if (!tripIds.length) return new Set();
    const r = await this.run('gds.closedForOta', (q) =>
      q<{ id: string }>(
        `SELECT t.id FROM trips t LEFT JOIN services s ON s.id = t.service_id
        WHERE t.id = ANY($1::uuid[]) AND ('ota' = ANY(t.closed_channels) OR 'ota' = ANY(coalesce(s.closed_channels, '{}')))`,
        [tripIds],
      ),
    );
    return new Set(r.map((x) => x.id));
  }
  async bookingOwner(
    bookingId: string,
  ): Promise<{ tenantId: string; partnerId: string | null } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
    const r = await this.run('gds.bookingOwner', (q) =>
      q<{ tenant_id: string; gds_partner_id: string | null }>(
        `SELECT tenant_id, gds_partner_id FROM bookings WHERE id = $1`,
        [bookingId],
      ),
    );
    return r[0] ? { tenantId: r[0].tenant_id, partnerId: r[0].gds_partner_id } : null;
  }
  /** GDS partners holding a live booking on this trip — they need to hear about delays/departure. */
  async partnersWithBookingsOnTrip(tripId: string): Promise<string[]> {
    if (!/^[0-9a-f-]{36}$/i.test(tripId)) return [];
    const r = await this.run('gds.partnersOnTrip', (q) =>
      q<{ gds_partner_id: string }>(
        `SELECT DISTINCT gds_partner_id FROM bookings
          WHERE trip_id = $1 AND gds_partner_id IS NOT NULL AND status IN ('confirmed', 'held')`,
        [tripId],
      ),
    );
    return r.map((x) => x.gds_partner_id);
  }
  async setBookingPartner(bookingId: BookingId, partnerId: string): Promise<void> {
    await this.run(
      'gds.setBookingPartner',
      (q) =>
        q(`UPDATE bookings SET gds_partner_id = $3 WHERE tenant_id = $1 AND id = $2`, [
          requireTenantId(),
          bookingId,
          partnerId,
        ]),
      false,
    );
  }

  /* ── operator side (tenant context, RLS applies) ── */
  async agreementsOfTenant() {
    return this.run(
      'gds.agreementsOfTenant',
      (q) =>
        q(
          `SELECT p.id AS "partnerId", p.code, p.name, p.kind, p.default_commission_pct AS "defaultCommissionPct",
              a.status, a.commission_pct AS "commissionPct", a.updated_at AS "updatedAt"
         FROM gds_partners p LEFT JOIN gds_agreements a ON a.partner_id = p.id AND a.tenant_id = $1
        WHERE p.status = 'active' ORDER BY p.name`,
          [requireTenantId()],
        ),
      false,
    );
  }
  async upsertAgreement(
    partnerId: string,
    status: 'active' | 'paused',
    commissionPct: number,
  ): Promise<void> {
    await this.run(
      'gds.upsertAgreement',
      (q) =>
        q(
          `INSERT INTO gds_agreements (tenant_id, partner_id, status, commission_pct) VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, partner_id) DO UPDATE SET status = EXCLUDED.status, commission_pct = EXCLUDED.commission_pct, updated_at = now()`,
          [requireTenantId(), partnerId, status, commissionPct],
        ),
      false,
    );
  }
}
