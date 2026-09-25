import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, requireTenantId, type AgentId, type BookingId, type UserId } from '@kernel';

import {
  signedAmount,
  type AgentLedgerKind,
  type AgentStatus,
  type BillingMode,
} from '../../domain/agent-account';
import type { Slab } from '../../domain/commission-slabs';

export interface Agent {
  id: AgentId;
  userId: UserId;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string;
  contactEmail: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  branchId: string | null;
  status: AgentStatus;
  statusReason: string | null;
  billingMode: BillingMode;
  commissionPct: number;
  creditLimitMinor: number;
  balanceMinor: number;
  lowBalanceAlertMinor: number;
  paymentTermsDays: number;
  createdAt: Date;
}

export interface AgentLedgerRow {
  id: string;
  kind: AgentLedgerKind;
  amountMinor: number;
  balanceAfterMinor: number;
  bookingId: string | null;
  pnr: string | null;
  reference: string | null;
  note: string | null;
  createdAt: Date;
}

export interface CreateAgentInput {
  userId: UserId;
  code: string;
  name: string;
  contactName?: string;
  contactPhone: string;
  contactEmail?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  branchId?: string;
  status: AgentStatus;
  billingMode: BillingMode;
  commissionPct: number;
  creditLimitMinor: number;
  lowBalanceAlertMinor: number;
  paymentTermsDays: number;
}

const COLUMNS = `id, user_id, code, name, contact_name, contact_phone, contact_email, gstin, pan, address, city,
  branch_id, status, status_reason, billing_mode, commission_pct, credit_limit_minor, balance_minor,
  low_balance_alert_minor, payment_terms_days, created_at`;

/**
 * Agents + their append-only account ledger. Every balance change goes
 * through `post()`, which (1) inserts the ledger row idempotently on
 * (agent, kind, reference) and only THEN (2) moves the balance — so a retried
 * debit/credit is a no-op, never a double charge. Callers hold the agent row
 * lock (`lockForUpdate`) inside a unit of work; the DB CHECK
 * `agents_spend_within_limit` is the final backstop against overspending.
 */
@Injectable()
export class AgentRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: CreateAgentInput): Promise<AgentId> {
    const id = newId() as AgentId;
    await this.db.execute_(
      `INSERT INTO agents (id, tenant_id, user_id, code, name, contact_name, contact_phone, contact_email, gstin, pan,
                           address, city, branch_id, status, billing_mode, commission_pct, credit_limit_minor,
                           low_balance_alert_minor, payment_terms_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        id,
        requireTenantId(),
        input.userId,
        input.code,
        input.name,
        input.contactName ?? null,
        input.contactPhone,
        input.contactEmail ?? null,
        input.gstin ?? null,
        input.pan ?? null,
        input.address ?? null,
        input.city ?? null,
        input.branchId ?? null,
        input.status,
        input.billingMode,
        input.commissionPct,
        input.creditLimitMinor,
        input.lowBalanceAlertMinor,
        input.paymentTermsDays,
      ],
      { name: 'agent.create', primary: true },
    );
    return id;
  }

  /** Agents counting towards the plan quota: every one not rejected. */
  async countActive(): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM agents WHERE tenant_id = $1 AND status <> 'rejected'`,
      [requireTenantId()],
      { name: 'agent.countActive', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.queryOne<{ one: number }>(
      `SELECT 1 AS one FROM agents WHERE tenant_id = $1 AND lower(code) = lower($2)`,
      [requireTenantId(), code],
      { name: 'agent.codeExists', primary: true },
    );
    return !!row;
  }

  async list(filter: { status?: AgentStatus; search?: string } = {}): Promise<Agent[]> {
    const rows = await this.db.query<AgentRow>(
      `SELECT ${COLUMNS} FROM agents
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR status = $2)
          AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR code ILIKE '%' || $3 || '%' OR contact_phone ILIKE '%' || $3 || '%')
        ORDER BY created_at DESC`,
      [requireTenantId(), filter.status ?? null, filter.search?.trim() || null],
      { name: 'agent.list' },
    );
    return rows.map(map);
  }

  async getById(id: AgentId): Promise<Agent | null> {
    const row = await this.db.queryOne<AgentRow>(
      `SELECT ${COLUMNS} FROM agents WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'agent.getById' },
    );
    return row ? map(row) : null;
  }

  async findByUserId(userId: UserId): Promise<Agent | null> {
    const row = await this.db.queryOne<AgentRow>(
      `SELECT ${COLUMNS} FROM agents WHERE tenant_id = $1 AND user_id = $2`,
      [requireTenantId(), userId],
      { name: 'agent.findByUserId', primary: true },
    );
    return row ? map(row) : null;
  }

  /** Row lock — every balance-moving path takes this first, inside a unit of work. */
  async lockForUpdate(id: AgentId): Promise<Agent | null> {
    const row = await this.db.queryOne<AgentRow>(
      `SELECT ${COLUMNS} FROM agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), id],
      { name: 'agent.lockForUpdate', primary: true },
    );
    return row ? map(row) : null;
  }

  async update(
    id: AgentId,
    input: Partial<
      Pick<
        CreateAgentInput,
        | 'name'
        | 'contactName'
        | 'contactPhone'
        | 'contactEmail'
        | 'gstin'
        | 'pan'
        | 'address'
        | 'city'
        | 'branchId'
        | 'billingMode'
        | 'commissionPct'
        | 'creditLimitMinor'
        | 'lowBalanceAlertMinor'
        | 'paymentTermsDays'
      >
    >,
  ): Promise<void> {
    await this.db.execute_(
      `UPDATE agents SET
         name = coalesce($3, name), contact_name = coalesce($4, contact_name),
         contact_phone = coalesce($5, contact_phone), contact_email = coalesce($6, contact_email),
         gstin = coalesce($7, gstin), pan = coalesce($8, pan), address = coalesce($9, address),
         city = coalesce($10, city), branch_id = coalesce($11::uuid, branch_id),
         billing_mode = coalesce($12, billing_mode), commission_pct = coalesce($13, commission_pct),
         credit_limit_minor = coalesce($14, credit_limit_minor),
         low_balance_alert_minor = coalesce($15, low_balance_alert_minor),
         payment_terms_days = coalesce($16, payment_terms_days)
       WHERE tenant_id = $1 AND id = $2`,
      [
        requireTenantId(),
        id,
        input.name ?? null,
        input.contactName ?? null,
        input.contactPhone ?? null,
        input.contactEmail ?? null,
        input.gstin ?? null,
        input.pan ?? null,
        input.address ?? null,
        input.city ?? null,
        input.branchId ?? null,
        input.billingMode ?? null,
        input.commissionPct ?? null,
        input.creditLimitMinor ?? null,
        input.lowBalanceAlertMinor ?? null,
        input.paymentTermsDays ?? null,
      ],
      { name: 'agent.update', primary: true },
    );
  }

  async setStatus(id: AgentId, status: AgentStatus, reason: string | null): Promise<void> {
    await this.db.execute_(
      `UPDATE agents SET status = $3, status_reason = $4 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, status, reason],
      { name: 'agent.setStatus', primary: true },
    );
  }

  /**
   * Post one ledger line and move the balance. Idempotent on
   * (agent, kind, reference) when a reference is given: returns
   * `{ applied: false }` if that exact line already exists.
   */
  async post(input: {
    agentId: AgentId;
    kind: AgentLedgerKind;
    magnitudeMinor: number;
    bookingId?: BookingId | null;
    reference?: string | null;
    note?: string | null;
    createdBy?: UserId | null;
  }): Promise<{ applied: boolean; balanceAfterMinor: number | null }> {
    const amount = signedAmount(input.kind, input.magnitudeMinor);
    const tenantId = requireTenantId();
    const id = newId();
    const inserted = await this.db.queryOne<{ id: string }>(
      `INSERT INTO agent_ledger (id, tenant_id, agent_id, kind, amount_minor, balance_after_minor, booking_id, reference, note, created_by)
       VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8,$9)
       ON CONFLICT (agent_id, kind, reference) WHERE reference IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        id,
        tenantId,
        input.agentId,
        input.kind,
        amount,
        input.bookingId ?? null,
        input.reference ?? null,
        input.note ?? null,
        input.createdBy ?? null,
      ],
      { name: 'agent.ledger.insert', primary: true },
    );
    if (!inserted) return { applied: false, balanceAfterMinor: null };

    const moved = await this.db.queryOne<{ balance_minor: string }>(
      `UPDATE agents SET balance_minor = balance_minor + $3 WHERE tenant_id = $1 AND id = $2 RETURNING balance_minor`,
      [tenantId, input.agentId, amount],
      { name: 'agent.balance.move', primary: true },
    );
    const balanceAfter = Number(moved?.balance_minor ?? 0);
    await this.db.execute_(
      `UPDATE agent_ledger SET balance_after_minor = $2 WHERE id = $1`,
      [id, balanceAfter],
      { name: 'agent.ledger.balanceAfter', primary: true },
    );
    return { applied: true, balanceAfterMinor: balanceAfter };
  }

  async ledger(
    agentId: AgentId,
    opts: { from?: string; to?: string; limit?: number } = {},
  ): Promise<AgentLedgerRow[]> {
    const rows = await this.db.query<LedgerRowRaw>(
      `SELECT l.id, l.kind, l.amount_minor, l.balance_after_minor, l.booking_id, b.pnr, l.reference, l.note, l.created_at
         FROM agent_ledger l
         LEFT JOIN bookings b ON b.id = l.booking_id
        WHERE l.tenant_id = $1 AND l.agent_id = $2
          AND ($3::date IS NULL OR l.created_at >= $3::date)
          AND ($4::date IS NULL OR l.created_at < ($4::date + 1))
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $5`,
      [
        requireTenantId(),
        agentId,
        opts.from ?? null,
        opts.to ?? null,
        Math.min(opts.limit ?? 200, 1000),
      ],
      { name: 'agent.ledger.list' },
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountMinor: Number(r.amount_minor),
      balanceAfterMinor: Number(r.balance_after_minor),
      bookingId: r.booking_id,
      pnr: r.pnr,
      reference: r.reference,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  /** Period statement: opening/closing balance and totals by kind. */
  async statement(
    agentId: AgentId,
    from: string,
    to: string,
  ): Promise<{
    openingMinor: number;
    closingMinor: number;
    totals: Record<string, number>;
    bookings: number;
  }> {
    const tenantId = requireTenantId();
    const opening = await this.db.queryOne<{ bal: string }>(
      `SELECT coalesce(sum(amount_minor), 0) AS bal FROM agent_ledger
        WHERE tenant_id = $1 AND agent_id = $2 AND created_at < $3::date`,
      [tenantId, agentId, from],
      { name: 'agent.statement.opening' },
    );
    const byKind = await this.db.query<{ kind: string; total: string; n: string }>(
      `SELECT kind, coalesce(sum(amount_minor), 0) AS total, count(DISTINCT booking_id) AS n FROM agent_ledger
        WHERE tenant_id = $1 AND agent_id = $2 AND created_at >= $3::date AND created_at < ($4::date + 1)
        GROUP BY kind`,
      [tenantId, agentId, from, to],
      { name: 'agent.statement.byKind' },
    );
    const totals = Object.fromEntries(byKind.map((r) => [r.kind, Number(r.total)]));
    const openingMinor = Number(opening?.bal ?? 0);
    const movement = Object.values(totals).reduce((s, v) => s + v, 0);
    const bookings = Number(byKind.find((r) => r.kind === 'booking_debit')?.n ?? 0);
    return { openingMinor, closingMinor: openingMinor + movement, totals, bookings };
  }

  /**
   * The ORIGINAL sale for a booking (for refund proportions): ticket value
   * debited (net of a reversal) and commission credited — plus how much
   * commission is still un-reversed. Proportions must use the original sale,
   * never the booking's current (already reduced) totals.
   */
  async saleFigures(
    agentId: AgentId,
    bookingId: BookingId,
  ): Promise<{ saleMinor: number; commissionMinor: number; remainingCommissionMinor: number }> {
    const row = await this.db.queryOne<{ sale: string; commission: string; remaining: string }>(
      `SELECT coalesce(-sum(amount_minor) FILTER (WHERE kind = 'booking_debit'), 0)
              - coalesce(sum(amount_minor) FILTER (WHERE kind = 'booking_reversal'), 0) AS sale,
              coalesce(sum(amount_minor) FILTER (WHERE kind = 'commission_credit'), 0) AS commission,
              coalesce(sum(amount_minor) FILTER (WHERE kind IN ('commission_credit', 'commission_reversal')), 0) AS remaining
         FROM agent_ledger WHERE tenant_id = $1 AND agent_id = $2 AND booking_id = $3`,
      [requireTenantId(), agentId, bookingId],
      { name: 'agent.saleFigures', primary: true },
    );
    return {
      saleMinor: Number(row?.sale ?? 0),
      commissionMinor: Number(row?.commission ?? 0),
      remainingCommissionMinor: Math.max(0, Number(row?.remaining ?? 0)),
    };
  }

  /** The agent's own slab table and the operator's default table. */
  async slabsFor(agentId: AgentId | null): Promise<{ agent: Slab[]; operator: Slab[] }> {
    const rows = await this.db.query<{ agent_id: string | null; min: string; pct: string }>(
      `SELECT agent_id, min_monthly_sales_minor AS min, commission_pct AS pct FROM agent_commission_slabs
        WHERE tenant_id = $1 AND (agent_id IS NULL OR agent_id = $2) ORDER BY min_monthly_sales_minor`,
      [requireTenantId(), agentId],
      { name: 'agent.slabs', primary: true },
    );
    const map = (r: { min: string; pct: string }): Slab => ({
      minMonthlySalesMinor: Number(r.min),
      commissionPct: Number(r.pct),
    });
    return {
      agent: agentId ? rows.filter((r) => r.agent_id === agentId).map(map) : [],
      operator: rows.filter((r) => r.agent_id === null).map(map),
    };
  }

  /** Replace a slab table (agentId null = operator default). Empty = remove it. Caller's transaction. */
  async replaceSlabs(agentId: AgentId | null, slabs: Slab[]): Promise<void> {
    const tenantId = requireTenantId();
    await this.db.execute_(
      `DELETE FROM agent_commission_slabs WHERE tenant_id = $1 AND agent_id IS NOT DISTINCT FROM $2`,
      [tenantId, agentId],
      { name: 'agent.slabs.clear', primary: true },
    );
    if (slabs.length === 0) return;
    await this.db.execute_(
      `INSERT INTO agent_commission_slabs (tenant_id, agent_id, min_monthly_sales_minor, commission_pct)
       SELECT $1, $2, s.min, s.pct FROM unnest($3::bigint[], $4::numeric[]) AS s(min, pct)`,
      [
        tenantId,
        agentId,
        slabs.map((s) => s.minMonthlySalesMinor),
        slabs.map((s) => s.commissionPct),
      ],
      { name: 'agent.slabs.insert', primary: true },
    );
  }

  /**
   * Month-to-date NET sales: tickets sold minus reversals and refunds, so
   * booking-and-cancelling cannot inflate an agent into a higher slab.
   */
  async monthSales(agentId: AgentId, since: Date): Promise<number> {
    const row = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(-sum(amount_minor) FILTER (WHERE kind = 'booking_debit'), 0)
              - coalesce(sum(amount_minor) FILTER (WHERE kind IN ('booking_reversal', 'refund_credit')), 0) AS total
         FROM agent_ledger WHERE tenant_id = $1 AND agent_id = $2 AND created_at >= $3`,
      [requireTenantId(), agentId, since],
      { name: 'agent.monthSales', primary: true },
    );
    return Math.max(0, Number(row?.total ?? 0));
  }

  /** Commission already credited to this agent for a booking (for refund clawback). */
  async commissionCredited(agentId: AgentId, bookingId: BookingId): Promise<number> {
    const row = await this.db.queryOne<{ total: string }>(
      `SELECT coalesce(sum(CASE WHEN kind = 'commission_credit' THEN amount_minor
                                WHEN kind = 'commission_reversal' THEN amount_minor ELSE 0 END), 0) AS total
         FROM agent_ledger WHERE tenant_id = $1 AND agent_id = $2 AND booking_id = $3`,
      [requireTenantId(), agentId, bookingId],
      { name: 'agent.commissionCredited', primary: true },
    );
    return Math.max(0, Number(row?.total ?? 0));
  }

  async setBookingAgent(bookingId: BookingId, agentId: AgentId): Promise<void> {
    await this.db.execute_(
      `UPDATE bookings SET agent_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), bookingId, agentId],
      { name: 'agent.setBookingAgent', primary: true },
    );
  }

  async agentForBooking(bookingId: BookingId): Promise<AgentId | null> {
    const row = await this.db.queryOne<{ agent_id: string | null }>(
      `SELECT agent_id FROM bookings WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), bookingId],
      { name: 'agent.forBooking', primary: true },
    );
    return (row?.agent_id ?? null) as AgentId | null;
  }

  async bookings(
    agentId: AgentId,
    opts: { status?: string; limit?: number } = {},
  ): Promise<unknown[]> {
    return this.db.query(
      `SELECT b.id, b.pnr, b.status, b.total_minor AS "totalMinor", b.currency, b.seat_count AS "seatCount",
              b.contact_phone AS "contactPhone", b.created_at AS "createdAt",
              t.journey_date AS "journeyDate", t.departs_at AS "departsAt", r.name AS "routeName"
         FROM bookings b
         JOIN trips t ON t.id = b.trip_id
         JOIN routes r ON r.id = b.route_id
        WHERE b.tenant_id = $1 AND b.agent_id = $2
          AND ($3::text IS NULL OR b.status::text = $3)
        ORDER BY b.created_at DESC
        LIMIT $4`,
      [requireTenantId(), agentId, opts.status ?? null, Math.min(opts.limit ?? 100, 500)],
      { name: 'agent.bookings' },
    );
  }

  /** Sales + commission per agent for the operator's dashboard. */
  async summary(): Promise<
    { agentId: string; bookings: number; salesMinor: number; commissionMinor: number }[]
  > {
    const rows = await this.db.query<{
      agent_id: string;
      bookings: string;
      sales: string;
      commission: string;
    }>(
      `SELECT agent_id,
              count(DISTINCT booking_id) FILTER (WHERE kind = 'booking_debit') AS bookings,
              coalesce(-sum(amount_minor) FILTER (WHERE kind = 'booking_debit'), 0)
                - coalesce(sum(amount_minor) FILTER (WHERE kind IN ('booking_reversal', 'refund_credit')), 0) AS sales,
              coalesce(sum(amount_minor) FILTER (WHERE kind IN ('commission_credit', 'commission_reversal')), 0) AS commission
         FROM agent_ledger WHERE tenant_id = $1 GROUP BY agent_id`,
      [requireTenantId()],
      { name: 'agent.summary' },
    );
    return rows.map((r) => ({
      agentId: r.agent_id,
      bookings: Number(r.bookings),
      salesMinor: Number(r.sales),
      commissionMinor: Number(r.commission),
    }));
  }
}

interface AgentRow {
  id: AgentId;
  user_id: UserId;
  code: string;
  name: string;
  contact_name: string | null;
  contact_phone: string;
  contact_email: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  branch_id: string | null;
  status: AgentStatus;
  status_reason: string | null;
  billing_mode: BillingMode;
  commission_pct: string;
  credit_limit_minor: string;
  balance_minor: string;
  low_balance_alert_minor: string;
  payment_terms_days: number;
  created_at: Date;
}

interface LedgerRowRaw {
  id: string;
  kind: AgentLedgerKind;
  amount_minor: string;
  balance_after_minor: string;
  booking_id: string | null;
  pnr: string | null;
  reference: string | null;
  note: string | null;
  created_at: Date;
}

function map(r: AgentRow): Agent {
  return {
    id: r.id,
    userId: r.user_id,
    code: r.code,
    name: r.name,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    gstin: r.gstin,
    pan: r.pan,
    address: r.address,
    city: r.city,
    branchId: r.branch_id,
    status: r.status,
    statusReason: r.status_reason,
    billingMode: r.billing_mode,
    commissionPct: Number(r.commission_pct),
    creditLimitMinor: Number(r.credit_limit_minor),
    balanceMinor: Number(r.balance_minor),
    lowBalanceAlertMinor: Number(r.low_balance_alert_minor),
    paymentTermsDays: r.payment_terms_days,
    createdAt: r.created_at,
  };
}
