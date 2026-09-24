import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { requireTenantId } from '@kernel';

import type { IncidentStatus, IncidentType, LostItemStatus, Severity } from '../domain/incident-rules';

/**
 * All persistence for incidents, lost & found, shift notes and dispatch
 * reports. Runs on the caller's transaction when there is one (DatabaseService
 * joins it), so row locks and atomicity are exactly as before.
 */
@Injectable()
export class IncidentRepository {
  constructor(private readonly db: DatabaseService) {}

  async tripExists(tripId: string): Promise<boolean> {
    return !!(await this.db.queryOne(`SELECT 1 FROM trips WHERE tenant_id = $1 AND id = $2`, [requireTenantId(), tripId], { name: 'incident.tripExists' }));
  }

  async insert(i: { id: string; tripId: string | null; type: IncidentType; severity: Severity; description: string | null; lat: number | null; lng: number | null; delayCategory: string | null; delayMinutes: number | null; diversionVia: string | null; reportedBy: string | null }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO incidents (id, tenant_id, trip_id, type, severity, description, lat, lng, delay_category, delay_minutes, diversion_via, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [i.id, requireTenantId(), i.tripId, i.type, i.severity, i.description, i.lat, i.lng, i.delayCategory, i.delayMinutes, i.diversionVia, i.reportedBy],
      { name: 'incident.insert' });
  }

  async setLiveDelay(tripId: string, minutes: number): Promise<void> {
    await this.db.execute_(`UPDATE trip_live SET delay_minutes = $3 WHERE tenant_id = $1 AND trip_id = $2`, [requireTenantId(), tripId, minutes], { name: 'incident.liveDelay' });
  }

  async statusForUpdate(id: string): Promise<IncidentStatus | null> {
    return (await this.db.queryOne<{ status: IncidentStatus }>(`SELECT status FROM incidents WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [requireTenantId(), id], { name: 'incident.lock' }))?.status ?? null;
  }

  async setStatus(id: string, to: IncidentStatus, by: string | null, note: string | null): Promise<void> {
    await this.db.execute_(
      `UPDATE incidents SET status = $3,
          acknowledged_by = CASE WHEN $3 = 'acknowledged' THEN $4 ELSE acknowledged_by END,
          acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN coalesce(acknowledged_at, now()) ELSE acknowledged_at END,
          resolved_by = CASE WHEN $3 = 'resolved' THEN $4 ELSE resolved_by END,
          resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE resolved_at END,
          resolution_note = CASE WHEN $3 = 'resolved' THEN $5 ELSE resolution_note END
        WHERE tenant_id = $1 AND id = $2`, [requireTenantId(), id, to, by, note], { name: 'incident.setStatus' });
  }

  async list(f: { status?: string; tripId?: string }) {
    return this.db.query<{ severity: Severity; status: IncidentStatus; created_at: Date } & Record<string, unknown>>(
      `SELECT i.*, u.full_name AS reported_by_name FROM incidents i LEFT JOIN users u ON u.id = i.reported_by
        WHERE i.tenant_id = $1 AND ($2::text IS NULL OR i.status = $2 OR ($2 = 'active' AND i.status IN ('open','acknowledged')))
          AND ($3::uuid IS NULL OR i.trip_id = $3)
        ORDER BY (i.severity = 'critical') DESC, i.created_at DESC LIMIT 200`, [requireTenantId(), f.status ?? null, f.tripId ?? null], { name: 'incident.list' });
  }

  /* lost & found */
  async insertItem(i: { id: string; tripId: string | null; description: string; seatNumber: string | null; storedAt: string | null; foundBy: string | null }): Promise<void> {
    await this.db.execute_(
      `INSERT INTO lost_found_items (id, tenant_id, trip_id, description, seat_number, stored_at, found_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [i.id, requireTenantId(), i.tripId, i.description, i.seatNumber, i.storedAt, i.foundBy], { name: 'lostFound.insert' });
  }
  async itemForUpdate(id: string): Promise<{ status: LostItemStatus; trip_id: string | null; found_at: Date } | null> {
    return this.db.queryOne(`SELECT status, trip_id, found_at FROM lost_found_items WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [requireTenantId(), id], { name: 'lostFound.lock' });
  }
  async tripOfPnr(pnr: string): Promise<string | null> {
    return (await this.db.queryOne<{ trip_id: string }>(`SELECT trip_id FROM bookings WHERE tenant_id = $1 AND upper(pnr) = upper($2)`, [requireTenantId(), pnr], { name: 'lostFound.pnrTrip' }))?.trip_id ?? null;
  }
  async markClaimed(id: string, claimant: string, pnr: string | null, by: string | null): Promise<void> {
    await this.db.execute_(`UPDATE lost_found_items SET status = 'claimed', claimant_name = $3, claim_pnr = $4, claimed_at = now(), handed_by = $5 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, claimant, pnr, by], { name: 'lostFound.claim' });
  }
  async markDisposed(id: string): Promise<void> {
    await this.db.execute_(`UPDATE lost_found_items SET status = 'disposed', disposed_at = now() WHERE tenant_id = $1 AND id = $2`, [requireTenantId(), id], { name: 'lostFound.dispose' });
  }
  async listItems(status?: string) {
    return this.db.query(`SELECT * FROM lost_found_items WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY found_at DESC LIMIT 200`, [requireTenantId(), status ?? null], { name: 'lostFound.list' });
  }

  /* shift notes */
  async insertNote(scope: string, note: string, branchId: string | null, by: string | null): Promise<void> {
    await this.db.execute_(`INSERT INTO shift_notes (tenant_id, scope, branch_id, note, written_by) VALUES ($1,$2,$3,$4,$5)`, [requireTenantId(), scope, branchId, note, by], { name: 'shiftNote.insert' });
  }
  async notes(scope: string, branchId: string | null) {
    return this.db.query(
      `SELECT n.id, n.note, n.created_at AS "createdAt", u.full_name AS "writtenBy" FROM shift_notes n LEFT JOIN users u ON u.id = n.written_by
        WHERE n.tenant_id = $1 AND n.scope = $2 AND ($3::uuid IS NULL OR n.branch_id = $3) ORDER BY n.created_at DESC LIMIT 20`, [requireTenantId(), scope, branchId], { name: 'shiftNote.list' });
  }

  /* dispatch report (read-only) */
  async dispatchSummary(from: string, to: string) {
    return this.db.queryOne<Record<string, number | null>>(
      `SELECT count(*) FILTER (WHERE status <> 'cancelled')::int AS "tripsRun",
              count(*) FILTER (WHERE status = 'cancelled')::int AS "tripsCancelled",
              count(*) FILTER (WHERE actual_departed_at IS NOT NULL)::int AS "tripsWithActuals",
              count(*) FILTER (WHERE actual_departed_at IS NOT NULL AND actual_departed_at <= departs_at + interval '10 minutes')::int AS "onTime",
              round(avg(greatest(0, extract(epoch FROM actual_departed_at - departs_at) / 60)) FILTER (WHERE actual_departed_at IS NOT NULL))::int AS "avgDepartureDelayMin"
         FROM trips WHERE tenant_id = $1 AND journey_date BETWEEN $2 AND $3`, [requireTenantId(), from, to], { name: 'dispatch.summary' });
  }
  async delayedTrips(from: string, to: string) {
    return this.db.query(
      `SELECT t.id AS "tripId", r.name AS "routeName", t.departs_at AS "scheduled", t.actual_departed_at AS "actual",
              round(extract(epoch FROM t.actual_departed_at - t.departs_at) / 60)::int AS "delayMin"
         FROM trips t JOIN routes r ON r.id = t.route_id
        WHERE t.tenant_id = $1 AND t.journey_date BETWEEN $2 AND $3 AND t.actual_departed_at > t.departs_at + interval '10 minutes'
        ORDER BY "delayMin" DESC LIMIT 100`, [requireTenantId(), from, to], { name: 'dispatch.delayed' });
  }
  async busUtilisation(from: string, to: string) {
    return this.db.query(
      `SELECT v.registration_no AS "bus", count(t.id)::int AS "trips",
              round(sum(extract(epoch FROM t.arrives_at - t.departs_at)) / 3600)::int AS "scheduledHours"
         FROM vehicles v LEFT JOIN trips t ON t.vehicle_id = v.id AND t.journey_date BETWEEN $2 AND $3 AND t.status <> 'cancelled'
        WHERE v.tenant_id = $1 AND v.status <> 'retired' GROUP BY v.registration_no ORDER BY "trips" DESC`, [requireTenantId(), from, to], { name: 'dispatch.buses' });
  }
  async crewPerformance(from: string, to: string) {
    return this.db.query(
      `SELECT c.full_name AS "name", c.role, count(d.id)::int AS "duties",
              count(d.id) FILTER (WHERE d.attendance = 'late')::int AS "late",
              count(d.id) FILTER (WHERE d.attendance = 'absent')::int AS "absent",
              coalesce(sum(d.driving_minutes), 0)::int AS "drivingMinutes"
         FROM crew c LEFT JOIN crew_duties d ON d.crew_id = c.id AND d.starts_at >= $2::date AND d.starts_at < $3::date + 1 AND d.status <> 'cancelled'
        WHERE c.tenant_id = $1 GROUP BY c.full_name, c.role ORDER BY "duties" DESC`, [requireTenantId(), from, to], { name: 'dispatch.crew' });
  }
}
