import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { getUserId, requireTenantId } from '@kernel';
import { FieldEncryptor } from '@security';
import { IS_STAFF } from './staff-sql';

export interface StaffRow {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  branchId: string | null;
  branchName: string | null;
  roles: { id: string; code: string; name: string; expiresAt: string | null }[];
  lastLoginAt: string | null;
  accessExpiresAt: string | null;
  loginWindow: { days: number[]; startMinute: number; endMinute: number } | null;
  managerId: string | null;
  managerName: string | null;
  createdAt: string;
}

export interface StaffPerformanceRow {
  userId: string;
  fullName: string;
  branchName: string | null;
  bookings: number;
  seats: number;
  revenueMinor: number;
  cancelled: number;
  cancellationRatePct: number;
  /** Daily target × days in the period (null = no target set). */
  targetBookings: number | null;
  targetRevenueMinor: number | null;
}

export interface StaffTarget {
  dailyBookings: number;
  dailyRevenueMinor: number | null;
  updatedAt: string;
}

export interface StaffWarning {
  id: string;
  reason: string;
  note: string;
  issuedByName: string | null;
  issuedAt: string;
  acknowledgedAt: string | null;
}

/**
 * The operator's staff: directory, activity and counter-sales performance.
 * Email and phone are encrypted at rest and decrypted here for staff who may
 * manage users — never matched by pattern (see UserRepository).
 */
@Injectable()
export class StaffDirectoryRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly encryptor: FieldEncryptor,
  ) {}

  private readonly select = `
    SELECT u.id, u.full_name AS "fullName", u.email, u.phone, u.status, u.branch_id AS "branchId",
           br.name AS "branchName", u.last_login_at AS "lastLoginAt", u.access_expires_at AS "accessExpiresAt",
           u.login_window AS "loginWindow",
           u.manager_id AS "managerId", m.full_name AS "managerName", u.created_at AS "createdAt",
           coalesce((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name, 'expiresAt', ur.expires_at) ORDER BY r.name)
                       FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
                      WHERE ur.user_id = u.id AND (ur.expires_at IS NULL OR ur.expires_at > now())), '[]') AS roles
      FROM users u
      LEFT JOIN branches br ON br.id = u.branch_id
      LEFT JOIN users m ON m.id = u.manager_id`;

  async list(input: {
    q?: string;
    status?: 'active' | 'disabled';
    branchId?: string;
    roleId?: string;
    offset: number;
    limit: number;
  }): Promise<StaffRow[]> {
    const q = input.q?.trim() ?? '';
    const rows = await this.db.query<StaffRow>(
      `${this.select}
        WHERE u.tenant_id = $1 AND ${IS_STAFF('u')} AND u.deleted_at IS NULL
          AND ($2::text = '' OR u.full_name ILIKE '%' || $2 || '%' OR u.email_blind = $3 OR u.phone_blind = $3)
          AND ($4::text IS NULL OR u.status::text = $4)
          AND ($5::uuid IS NULL OR u.branch_id = $5)
          AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = $6))
        ORDER BY u.status, u.full_name
        OFFSET $7 LIMIT $8`,
      [
        requireTenantId(),
        q,
        q ? this.encryptor.blindIndex(q) : null,
        input.status ?? null,
        input.branchId ?? null,
        input.roleId ?? null,
        input.offset,
        input.limit,
      ],
      { name: 'staff.list' },
    );
    return rows.map((r) => this.reveal(r));
  }

  async find(id: string): Promise<StaffRow | null> {
    const row = await this.db.queryOne<StaffRow>(
      `${this.select}
        WHERE u.tenant_id = $1 AND ${IS_STAFF('u')} AND u.deleted_at IS NULL AND u.id = $2`,
      [requireTenantId(), id],
      { name: 'staff.find', primary: true },
    );
    return row ? this.reveal(row) : null;
  }

  /** Active staff who can still manage users — the last one must never lock the operator out. */
  async activeUserManagers(excluding?: string, withoutRoleId?: string): Promise<number> {
    const row = await this.db.queryOne<{ n: number }>(
      `SELECT count(DISTINCT u.id)::int AS n
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND (ur.expires_at IS NULL OR ur.expires_at > now())
         JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission IN ('user:manage', '*')
        WHERE u.tenant_id = $1 AND ${IS_STAFF('u')} AND u.status = 'active' AND u.deleted_at IS NULL
          AND ($2::uuid IS NULL OR u.id <> $2) AND ($3::uuid IS NULL OR ur.role_id <> $3)`,
      [requireTenantId(), excluding ?? null, withoutRoleId ?? null],
      { name: 'staff.activeUserManagers', primary: true },
    );
    return row?.n ?? 0;
  }

  /** Whether any of this user's current roles lets them manage users. */
  async canManageUsers(userId: string, withoutRoleId?: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.permission IN ('user:manage', '*')
        WHERE ur.user_id = $1 AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND ($2::uuid IS NULL OR ur.role_id <> $2)
        LIMIT 1`,
      [userId, withoutRoleId ?? null],
      { name: 'staff.canManageUsers', primary: true },
    );
    return !!row;
  }

  async setBranch(userId: string, branchId: string | null): Promise<void> {
    await this.db.execute_(
      `UPDATE users SET branch_id = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), userId, branchId],
      { name: 'staff.setBranch', primary: true },
    );
  }

  async activeBranch(branchId: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM branches WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
      [requireTenantId(), branchId],
      { name: 'staff.activeBranch', primary: true },
    );
    return !!row;
  }

  /** An active branch of this operator by name (any case) — for staff uploads. */
  async activeBranchIdByName(name: string): Promise<string | null> {
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM branches WHERE tenant_id = $1 AND status = 'active' AND lower(name) = lower($2) LIMIT 1`,
      [requireTenantId(), name.trim()],
      { name: 'staff.branchByName' },
    );
    return row?.id ?? null;
  }

  /** What this staff member did, newest first (the audit trail). */
  activity(userId: string, limit = 50): Promise<unknown[]> {
    return this.db.query(
      `SELECT action, resource_type AS "resourceType", resource_id AS "resourceId", changes,
              occurred_at AS "occurredAt"
         FROM audit_log WHERE tenant_id = $1 AND actor_id = $2
        ORDER BY occurred_at DESC LIMIT $3`,
      [requireTenantId(), userId, Math.min(limit, 200)],
      { name: 'staff.activity', timeoutMs: 30_000 },
    );
  }

  /**
   * Counter sales per staff member over a period of the operator's days, with
   * the daily target scaled to the number of days.
   */
  performance(from: string, to: string, timezone: string): Promise<StaffPerformanceRow[]> {
    return this.db.query<StaffPerformanceRow>(
      `WITH sales AS (
         SELECT u.id AS user_id,
                count(b.id) FILTER (WHERE b.status IN ('confirmed','completed','cancelled'))::int AS bookings,
                coalesce(sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')), 0)::int AS seats,
                coalesce(sum(b.paid_minor) FILTER (WHERE b.status IN ('confirmed','completed')), 0)::float8 AS revenue,
                count(b.id) FILTER (WHERE b.status = 'cancelled')::int AS cancelled
           FROM users u
           LEFT JOIN bookings b ON b.booked_by = u.id AND b.tenant_id = u.tenant_id
                                AND (b.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
          WHERE u.tenant_id = $1 AND ${IS_STAFF('u')} AND u.deleted_at IS NULL
          GROUP BY u.id)
       SELECT u.id AS "userId", u.full_name AS "fullName", br.name AS "branchName",
              s.bookings, s.seats, s.revenue AS "revenueMinor", s.cancelled,
              CASE WHEN s.bookings > 0 THEN round(100.0 * s.cancelled / s.bookings, 1) ELSE 0 END::float8
                AS "cancellationRatePct",
              (t.daily_bookings * ($3::date - $2::date + 1))::int AS "targetBookings",
              (t.daily_revenue_minor * ($3::date - $2::date + 1))::float8 AS "targetRevenueMinor"
         FROM sales s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN branches br ON br.id = u.branch_id
         LEFT JOIN staff_targets t ON t.tenant_id = u.tenant_id AND t.user_id = u.id
        ORDER BY "revenueMinor" DESC, s.bookings DESC, u.full_name`,
      [requireTenantId(), from, to, timezone],
      { name: 'staff.performance' },
    );
  }

  async target(userId: string): Promise<StaffTarget | null> {
    return this.db.queryOne<StaffTarget>(
      `SELECT daily_bookings AS "dailyBookings", daily_revenue_minor::float8 AS "dailyRevenueMinor",
              updated_at AS "updatedAt"
         FROM staff_targets WHERE tenant_id = $1 AND user_id = $2`,
      [requireTenantId(), userId],
      { name: 'staff.target' },
    );
  }

  async setTarget(
    userId: string,
    target: { dailyBookings: number; dailyRevenueMinor: number | null } | null,
  ): Promise<void> {
    if (!target) {
      await this.db.execute_(
        `DELETE FROM staff_targets WHERE tenant_id = $1 AND user_id = $2`,
        [requireTenantId(), userId],
        { name: 'staff.clearTarget', primary: true },
      );
      return;
    }
    await this.db.execute_(
      `INSERT INTO staff_targets (tenant_id, user_id, daily_bookings, daily_revenue_minor, set_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET daily_bookings = EXCLUDED.daily_bookings, daily_revenue_minor = EXCLUDED.daily_revenue_minor,
             set_by = EXCLUDED.set_by, updated_at = now()`,
      [
        requireTenantId(),
        userId,
        target.dailyBookings,
        target.dailyRevenueMinor,
        getUserId() ?? null,
      ],
      { name: 'staff.setTarget', primary: true },
    );
  }

  warnings(userId: string): Promise<StaffWarning[]> {
    return this.db.query<StaffWarning>(
      `SELECT w.id, w.reason, w.note, i.full_name AS "issuedByName", w.issued_at AS "issuedAt",
              w.acknowledged_at AS "acknowledgedAt"
         FROM staff_warnings w LEFT JOIN users i ON i.id = w.issued_by
        WHERE w.tenant_id = $1 AND w.user_id = $2
        ORDER BY w.issued_at DESC LIMIT 50`,
      [requireTenantId(), userId],
      { name: 'staff.warnings' },
    );
  }

  /** The same warning to the same person in the last few minutes — a double click. */
  async recentSameWarning(userId: string, reason: string, note: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM staff_warnings
        WHERE tenant_id = $1 AND user_id = $2 AND reason = $3 AND note = $4
          AND issued_at > now() - interval '10 minutes' LIMIT 1`,
      [requireTenantId(), userId, reason, note],
      { name: 'staff.recentWarning', primary: true },
    );
    return !!row;
  }

  async addWarning(userId: string, reason: string, note: string): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO staff_warnings (tenant_id, user_id, reason, note, issued_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [requireTenantId(), userId, reason, note, getUserId()],
      { name: 'staff.addWarning', primary: true },
    );
    return row!.id;
  }

  /** Only the person warned acknowledges it, once. False when there is nothing to acknowledge. */
  async acknowledgeWarning(id: string, userId: string): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE staff_warnings SET acknowledged_at = now()
        WHERE tenant_id = $1 AND id = $2 AND user_id = $3 AND acknowledged_at IS NULL`,
      [requireTenantId(), id, userId],
      { name: 'staff.ackWarning', primary: true },
    );
    return n > 0;
  }

  private reveal(r: StaffRow): StaffRow {
    return { ...r, email: this.encryptor.decrypt(r.email), phone: this.encryptor.decrypt(r.phone) };
  }
}
