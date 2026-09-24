import { Injectable } from '@nestjs/common';
import { RECOMMENDED_REST_RULES, type RestRules } from '../../domain/duty-roster';

import { DatabaseService } from '@database';
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

export type CrewRole = 'driver' | 'conductor' | 'attendant';

export interface Crew {
  id: CrewId;
  role: CrewRole;
  fullName: string;
  status: string;
  licenceNo: string | null;
  licenceExpiresOn: LocalDate | null;
}

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

  async getById(id: CrewId): Promise<Crew> {
    const row = await this.db.queryOne<CrewRow>(
      `SELECT id, role, full_name, status, licence_no, licence_expires_on
         FROM crew WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), id],
      { name: 'crew.getById' },
    );
    if (!row) throw new NotFoundError('Crew', id);
    return mapCrew(row);
  }

  async list(role?: CrewRole): Promise<Crew[]> {
    const rows = await this.db.query<CrewRow>(
      `SELECT id, role, full_name, status, licence_no, licence_expires_on
         FROM crew WHERE tenant_id = $1 AND deleted_at IS NULL ${role ? 'AND role = $2' : ''}
        ORDER BY full_name`,
      role ? [requireTenantId(), role] : [requireTenantId()],
      { name: 'crew.list' },
    );
    return rows.map(mapCrew);
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
  async listUpcomingDuties(limit = 100): Promise<
    {
      id: string;
      crewId: string;
      crewName: string;
      tripId: string | null;
      startsAt: Date;
      endsAt: Date;
      drivingMinutes: number;
    }[]
  > {
    return this.db.query(
      `SELECT d.id, d.crew_id AS "crewId", c.full_name AS "crewName", d.trip_id AS "tripId",
              d.starts_at AS "startsAt", d.ends_at AS "endsAt", d.driving_minutes AS "drivingMinutes"
         FROM crew_duties d JOIN crew c ON c.id = d.crew_id
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
  };
}
