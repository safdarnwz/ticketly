import { Injectable } from '@nestjs/common';
import { RECOMMENDED_REST_RULES, type RestRules } from '../../domain/duty-roster';

import { DatabaseService, registerConstraintMessages } from '@database';
import {
  newId,
  NotFoundError,
  requireTenantId,
  type CrewId,
  type DutyId,
  type LocalDate,
  type TripId,
} from '@kernel';

import type { Duty } from '../../domain/duty-roster';
import { type CrewRole } from '../../domain/crew';

export type { CrewRole };

export interface Crew {
  id: CrewId;
  role: CrewRole;
  fullName: string;
  status: string;
  licenceNo: string | null;
  licenceExpiresOn: LocalDate | null;
  phone: string | null;
  employeeCode: string | null;
  /** Upcoming duties still assigned. */
  upcomingDuties: number;
}

registerConstraintMessages({
  crew_tenant_id_employee_code_key: 'Another crew member already has this employee code',
});

const CREW_COLUMNS = `c.id, c.role, c.full_name, c.status, c.licence_no, c.licence_expires_on, c.phone, c.employee_code,
  (SELECT count(*) FROM crew_duties d WHERE d.crew_id = c.id AND d.status = 'assigned' AND d.ends_at > now()) AS upcoming_duties`;

@Injectable()
export class CrewRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    role: CrewRole;
    fullName: string;
    phone?: string;
    licenceNo?: string;
    licenceExpiresOn?: LocalDate;
    employeeCode?: string;
  }): Promise<CrewId> {
    const id = newId() as CrewId;
    await this.db.execute_(
      `INSERT INTO crew (id, tenant_id, role, full_name, phone, licence_no, licence_expires_on, employee_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        requireTenantId(),
        input.role,
        input.fullName.trim(),
        input.phone ?? null,
        input.licenceNo ?? null,
        input.licenceExpiresOn ?? null,
        input.employeeCode ?? null,
      ],
      { name: 'crew.create', primary: true },
    );
    return id;
  }

  async getById(id: CrewId, forUpdate = false): Promise<Crew> {
    const row = await this.db.queryOne<CrewRow>(
      `SELECT ${CREW_COLUMNS}
         FROM crew c WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL${forUpdate ? ' FOR UPDATE' : ''}`,
      [requireTenantId(), id],
      { name: 'crew.getById', primary: forUpdate },
    );
    if (!row) throw new NotFoundError('Crew', id);
    return mapCrew(row);
  }

  async list(filter: { role?: CrewRole; status?: string } = {}): Promise<Crew[]> {
    const params: unknown[] = [requireTenantId()];
    let where = 'c.tenant_id = $1 AND c.deleted_at IS NULL';
    if (filter.role) {
      params.push(filter.role);
      where += ` AND c.role = $${params.length}`;
    }
    if (filter.status) {
      params.push(filter.status);
      where += ` AND c.status = $${params.length}::crew_status`;
    }
    const rows = await this.db.query<CrewRow>(
      `SELECT ${CREW_COLUMNS} FROM crew c WHERE ${where} ORDER BY c.full_name`,
      params,
      { name: 'crew.list' },
    );
    return rows.map(mapCrew);
  }

  /** Another crew member (not `except`) with this mobile, if any — older rows may hold +91 or spaces. */
  async phoneTakenBy(phone: string, except?: CrewId): Promise<string | null> {
    const row = await this.db.queryOne<{ full_name: string }>(
      `SELECT full_name FROM crew
        WHERE tenant_id = $1 AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2
          AND deleted_at IS NULL AND ($3::uuid IS NULL OR id <> $3)`,
      [requireTenantId(), phone, except ?? null],
      { name: 'crew.phoneTaken' },
    );
    return row?.full_name ?? null;
  }

  async update(
    id: CrewId,
    patch: {
      fullName?: string;
      phone?: string | null;
      licenceNo?: string | null;
      licenceExpiresOn?: LocalDate | null;
      employeeCode?: string | null;
      status?: string;
    },
  ): Promise<void> {
    const cols: Record<string, string> = {
      fullName: 'full_name',
      phone: 'phone',
      licenceNo: 'licence_no',
      licenceExpiresOn: 'licence_expires_on',
      employeeCode: 'employee_code',
      status: 'status',
    };
    const sets: string[] = [];
    const params: unknown[] = [requireTenantId(), id];
    for (const [k, col] of Object.entries(cols)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}${k === 'status' ? '::crew_status' : ''}`);
    }
    if (sets.length === 0) return;
    await this.db.execute_(
      `UPDATE crew SET ${sets.join(', ')}, version = version + 1 WHERE tenant_id = $1 AND id = $2`,
      params,
      { name: 'crew.update', primary: true },
    );
  }

  /**
   * Load a crew member's existing duties within a time window, as the domain
   * `Duty` shape the roster checker expects. The window bounds the scan so we
   * never load a driver's entire history to check one assignment.
   */
  async loadDuties(crewId: CrewId, fromMs: number, toMs: number): Promise<Duty[]> {
    const rows = await this.db.query<DutyRow>(
      `SELECT id, crew_id, starts_at, ends_at, driving_minutes
         FROM crew_duties
        WHERE tenant_id = $1 AND crew_id = $2 AND status = 'assigned'
          AND ends_at > to_timestamp($3 / 1000.0) AND starts_at < to_timestamp($4 / 1000.0)`,
      [requireTenantId(), crewId, fromMs, toMs],
      { name: 'crew.loadDuties', primary: true },
    );
    return rows.map((r) => ({
      id: r.id,
      crewId: r.crew_id,
      startMs: new Date(r.starts_at).getTime(),
      endMs: new Date(r.ends_at).getTime(),
      drivingMinutes: r.driving_minutes,
    }));
  }

  /**
   * Insert a duty. Relies on the DB exclusion constraint as the final backstop:
   * if two concurrent requests both pass the application check, the second
   * INSERT fails with a unique/exclusion violation, which the mapper turns into
   * a clean 409 rather than a double-booked driver.
   */
  /** Active drivers whose licence expires within `days`, has expired, or is not on file. */
  expiringLicences(days: number): Promise<
    {
      crewId: string;
      fullName: string;
      licenceNo: string | null;
      expiresOn: string | null;
      daysLeft: number | null;
    }[]
  > {
    return this.db.query(
      `SELECT id AS "crewId", full_name AS "fullName", licence_no AS "licenceNo",
              licence_expires_on::text AS "expiresOn", (licence_expires_on - current_date)::int AS "daysLeft"
         FROM crew
        WHERE tenant_id = $1 AND deleted_at IS NULL AND role = 'driver' AND status <> 'inactive'
          AND (licence_expires_on IS NULL OR licence_expires_on <= current_date + $2::int)
        ORDER BY licence_expires_on NULLS FIRST, full_name`,
      [requireTenantId(), days],
      { name: 'crew.expiringLicences' },
    );
  }

  /** The trip a duty is for — this operator's only; null when not found. */
  async tripForDuty(tripId: TripId): Promise<{ status: string } | null> {
    return this.db.queryOne<{ status: string }>(
      `SELECT status::text AS status FROM trips WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), tripId],
      { name: 'crew.tripForDuty' },
    );
  }

  async insertDuty(input: {
    crewId: CrewId;
    tripId: TripId | null;
    startsAt: Date;
    endsAt: Date;
    drivingMinutes: number;
    override?: { reason: string; conflicts: unknown[]; approvedBy: string | null };
  }): Promise<DutyId> {
    const id = newId() as DutyId;
    await this.db.execute_(
      `INSERT INTO crew_duties (id, tenant_id, crew_id, trip_id, starts_at, ends_at, driving_minutes, override_reason, override_conflicts, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        requireTenantId(),
        input.crewId,
        input.tripId,
        input.startsAt,
        input.endsAt,
        input.drivingMinutes,
        input.override?.reason ?? null,
        input.override ? JSON.stringify(input.override.conflicts) : null,
        input.override?.approvedBy ?? null,
      ],
      { name: 'crew.insertDuty', primary: true },
    );
    return id;
  }

  /** The operator's rest rules, or the recommended defaults (incl. the 5-hour continuous-driving limit). */
  async loadRules(): Promise<RestRules> {
    const r = await this.db.queryOne<{
      min_rest_minutes: number;
      max_daily_driving_minutes: number;
      max_duty_minutes: number;
      max_continuous_driving_minutes: number | null;
    }>(
      `SELECT min_rest_minutes, max_daily_driving_minutes, max_duty_minutes, max_continuous_driving_minutes FROM crew_rest_rules WHERE tenant_id = $1`,
      [requireTenantId()],
      { name: 'crew.rules' },
    );
    return r
      ? {
          minRestMinutes: r.min_rest_minutes,
          maxDailyDrivingMinutes: r.max_daily_driving_minutes,
          maxDutyMinutes: r.max_duty_minutes,
          maxContinuousDrivingMinutes: r.max_continuous_driving_minutes ?? undefined,
        }
      : RECOMMENDED_REST_RULES;
  }

  async saveRules(r: RestRules, by: string | null): Promise<void> {
    await this.db.execute_(
      `INSERT INTO crew_rest_rules (tenant_id, min_rest_minutes, max_daily_driving_minutes, max_duty_minutes, max_continuous_driving_minutes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id) DO UPDATE SET min_rest_minutes = EXCLUDED.min_rest_minutes, max_daily_driving_minutes = EXCLUDED.max_daily_driving_minutes,
         max_duty_minutes = EXCLUDED.max_duty_minutes, max_continuous_driving_minutes = EXCLUDED.max_continuous_driving_minutes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [
        requireTenantId(),
        r.minRestMinutes,
        r.maxDailyDrivingMinutes,
        r.maxDutyMinutes,
        r.maxContinuousDrivingMinutes ?? null,
        by,
      ],
      { name: 'crew.saveRules', primary: true },
    );
  }

  async dutyForUpdate(id: DutyId): Promise<{
    id: string;
    crewId: string;
    tripId: string | null;
    startsAt: Date;
    endsAt: Date;
    status: string;
    attendance: string;
  } | null> {
    return this.db.queryOne(
      `SELECT id, crew_id AS "crewId", trip_id AS "tripId", starts_at AS "startsAt", ends_at AS "endsAt", status::text AS status, attendance
         FROM crew_duties WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [requireTenantId(), id],
      { name: 'crew.dutyForUpdate', primary: true },
    );
  }

  async setAttendance(id: DutyId, attendance: string, by: string | null): Promise<void> {
    await this.db.execute_(
      `UPDATE crew_duties SET attendance = $3, reported_at = CASE WHEN $3 IN ('present', 'late') THEN now() ELSE NULL END, attendance_marked_by = $4
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, attendance, by],
      { name: 'crew.setAttendance', primary: true },
    );
  }

  /** Duties in a period with an approved exception or an attendance problem (compliance view). */
  async compliance(fromIso: string, toIso: string) {
    return this.db.query(
      `SELECT d.id, c.full_name AS "crewName", c.role, d.trip_id AS "tripId", d.starts_at AS "startsAt", d.ends_at AS "endsAt",
              d.driving_minutes AS "drivingMinutes", d.attendance, d.override_reason AS "overrideReason", d.override_conflicts AS "overrideConflicts",
              u.full_name AS "approvedBy"
         FROM crew_duties d JOIN crew c ON c.id = d.crew_id LEFT JOIN users u ON u.id = d.approved_by
        WHERE d.tenant_id = $1 AND d.starts_at >= $2::date AND d.starts_at < $3::date + 1 AND d.status <> 'cancelled'
          AND (d.override_conflicts IS NOT NULL OR d.attendance IN ('late', 'absent') OR (d.attendance = 'pending' AND d.starts_at < now() - interval '15 minutes'))
        ORDER BY d.starts_at`,
      [requireTenantId(), fromIso, toIso],
      { name: 'crew.compliance' },
    );
  }

  async cancelDuty(id: DutyId): Promise<void> {
    await this.db.execute_(
      `UPDATE crew_duties SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'crew.cancelDuty', primary: true },
    );
  }

  /** Every upcoming assigned duty across all crew — for the roster view. */
  async listUpcomingDuties(limit = 200): Promise<
    {
      id: string;
      crewId: string;
      crewName: string;
      crewRole: string;
      tripId: string | null;
      tripLabel: string | null;
      startsAt: Date;
      endsAt: Date;
      drivingMinutes: number;
      attendance: string;
      overrideReason: string | null;
    }[]
  > {
    return this.db.query(
      `SELECT d.id, d.crew_id AS "crewId", c.full_name AS "crewName", c.role::text AS "crewRole", d.trip_id AS "tripId",
              CASE WHEN t.id IS NULL THEN NULL ELSE s.code || ' · ' || to_char(t.journey_date, 'DD Mon') END AS "tripLabel",
              d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.driving_minutes AS "drivingMinutes",
              d.attendance, d.override_reason AS "overrideReason"
         FROM crew_duties d JOIN crew c ON c.id = d.crew_id
         LEFT JOIN trips t ON t.id = d.trip_id AND t.tenant_id = d.tenant_id
         LEFT JOIN services s ON s.id = t.service_id
        WHERE d.tenant_id = $1 AND d.status = 'assigned' AND d.ends_at > now()
        ORDER BY d.starts_at LIMIT $2`,
      [requireTenantId(), limit],
      { name: 'crew.listUpcomingDuties' },
    );
  }
}

interface CrewRow {
  id: CrewId;
  role: CrewRole;
  full_name: string;
  status: string;
  licence_no: string | null;
  licence_expires_on: LocalDate | null;
  phone: string | null;
  employee_code: string | null;
  upcoming_duties: number;
}
interface DutyRow {
  id: string;
  crew_id: string;
  starts_at: string;
  ends_at: string;
  driving_minutes: number;
}
function mapCrew(r: CrewRow): Crew {
  return {
    id: r.id,
    role: r.role,
    fullName: r.full_name,
    status: r.status,
    licenceNo: r.licence_no,
    licenceExpiresOn: r.licence_expires_on,
    phone: r.phone,
    employeeCode: r.employee_code,
    upcomingDuties: Number(r.upcoming_duties),
  };
}
