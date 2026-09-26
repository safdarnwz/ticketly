import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { AppError, ErrorCode, NotFoundError, getUserId, newId, requireTenantId } from '@kernel';
import { EventBus } from '@messaging';

import {
  IncidentRuleError,
  assertTransition,
  canDispose,
  checkClaim,
  isOverdue,
  severityFor,
  validateReport,
  type IncidentStatus,
  type IncidentType,
} from '../domain/incident-rules';
import { IncidentRepository } from '../infrastructure/incident.repository';
import { BranchRepository } from '../../branches';

const MAX_REPORT_DAYS = 366;

const ruleError = (e: unknown): never => {
  if (e instanceof IncidentRuleError)
    throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message: e.message });
  throw e;
};
const validationError = (message: string): never => {
  throw new AppError(ErrorCode.COMMON_VALIDATION, 422, { message });
};

/**
 * Use cases for incidents, lost & found, shift notes and dispatch reports.
 * Rules live in domain/incident-rules.ts; SQL lives in IncidentRepository;
 * this class only orchestrates: validate → transaction → persist → events.
 * A CRITICAL incident publishes incident.critical (emergency contacts are
 * alerted by the worker); delay and diversion notify passengers.
 */
@Injectable()
export class IncidentService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly repo: IncidentRepository,
    private readonly branches: BranchRepository,
  ) {}

  async report(input: {
    tripId?: string | null;
    type: IncidentType;
    description?: string;
    lat?: number;
    lng?: number;
    delayCategory?: string;
    delayMinutes?: number;
    diversionVia?: string;
  }) {
    try {
      validateReport(input);
    } catch (e) {
      ruleError(e);
    }
    const severity = severityFor(input.type);
    return this.uow.run({ name: 'incident.report', tenantId: requireTenantId() }, async () => {
      if (input.tripId && !(await this.repo.tripExists(input.tripId)))
        throw new NotFoundError('Trip', input.tripId);
      const id = newId();
      await this.repo.insert({
        id,
        tripId: input.tripId ?? null,
        type: input.type,
        severity,
        description: input.description?.trim() || null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        delayCategory: input.delayCategory ?? null,
        delayMinutes: input.delayMinutes ?? null,
        diversionVia: input.diversionVia?.trim() || null,
        reportedBy: getUserId() ?? null,
      });
      if (input.type === 'delay' && input.tripId)
        await this.repo.setLiveDelay(input.tripId, input.delayMinutes!);
      const payload = {
        incidentId: id,
        tripId: input.tripId ?? null,
        type: input.type,
        severity,
        description: input.description ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        delayCategory: input.delayCategory ?? null,
        delayMinutes: input.delayMinutes ?? null,
        diversionVia: input.diversionVia ?? null,
      };
      if (severity === 'critical')
        this.events.publish({
          type: 'incident.critical',
          aggregateType: 'incident',
          aggregateId: id,
          payload,
        });
      if (input.type === 'delay' && input.tripId)
        this.events.publish({
          type: 'trip.delayed',
          aggregateType: 'trip',
          aggregateId: input.tripId,
          payload: { delayMinutes: input.delayMinutes ?? 0, reason: input.delayCategory ?? null },
        });
      if (input.type === 'diversion' && input.tripId)
        this.events.publish({
          type: 'trip.diverted',
          aggregateType: 'trip',
          aggregateId: input.tripId,
          payload,
        });
      return { id, severity };
    });
  }

  async transition(id: string, to: IncidentStatus, note?: string) {
    return this.uow.run({ name: 'incident.transition', tenantId: requireTenantId() }, async () => {
      const current = await this.repo.statusForUpdate(id);
      if (!current) throw new NotFoundError('Incident', id);
      try {
        assertTransition(current, to, note);
      } catch (e) {
        ruleError(e);
      }
      await this.repo.setStatus(id, to, getUserId() ?? null, note?.trim() ?? null);
      return { id, status: to };
    });
  }

  async list(filter: { status?: string; tripId?: string }) {
    const rows = await this.repo.list(filter);
    return rows.map((r) => ({
      ...r,
      overdue: isOverdue({ severity: r.severity, status: r.status, reportedAt: r.created_at }),
    }));
  }

  /* ── lost & found ── */
  async logItem(input: {
    tripId?: string | null;
    description: string;
    seatNumber?: string;
    storedAt?: string;
  }) {
    return this.uow.run({ name: 'lostFound.log', tenantId: requireTenantId() }, async () => {
      // Only this operator's trips — the database key alone would accept anyone's.
      if (input.tripId && !(await this.repo.tripExists(input.tripId)))
        throw new NotFoundError('Trip', input.tripId);
      const id = newId();
      await this.repo.insertItem({
        id,
        tripId: input.tripId ?? null,
        description: input.description.trim(),
        seatNumber: input.seatNumber?.trim().toUpperCase() || null,
        storedAt: input.storedAt?.trim() || null,
        foundBy: getUserId() ?? null,
      });
      return { id };
    });
  }

  async claimItem(id: string, input: { claimantName: string; pnr?: string }) {
    return this.uow.run({ name: 'lostFound.claim', tenantId: requireTenantId() }, async () => {
      const item = await this.repo.itemForUpdate(id);
      if (!item) throw new NotFoundError('Item', id);
      if (item.trip_id && !input.pnr) validationError('Enter the claimant’s PNR for this trip');
      const pnrTrip = input.pnr ? await this.repo.tripOfPnr(input.pnr.trim()) : null;
      const problem = checkClaim({
        itemStatus: item.status,
        itemTripId: item.trip_id,
        claimPnrTripId: pnrTrip,
        claimantName: input.claimantName,
      });
      if (problem) validationError(problem);
      await this.repo.markClaimed(
        id,
        input.claimantName.trim(),
        input.pnr?.trim().toUpperCase() ?? null,
        getUserId() ?? null,
      );
      return { ok: true };
    });
  }

  async disposeItem(id: string) {
    return this.uow.run({ name: 'lostFound.dispose', tenantId: requireTenantId() }, async () => {
      const item = await this.repo.itemForUpdate(id);
      if (!item) throw new NotFoundError('Item', id);
      const problem = canDispose({ itemStatus: item.status, foundAt: item.found_at });
      if (problem) validationError(problem);
      await this.repo.markDisposed(id);
      return { ok: true };
    });
  }

  listItems(status?: string) {
    return this.repo.listItems(status);
  }

  /* ── shift handover (453 / 454 / 613) ── */
  async addNote(scopeName: 'dispatch' | 'branch', note: string, branchId?: string | null) {
    if (scopeName === 'branch' && !branchId) validationError('Pick the branch this note is for');
    if (scopeName === 'dispatch' && branchId)
      validationError('A dispatch-desk note is not tied to a branch');
    if (branchId) {
      const branch = await this.branches.find(branchId as never);
      if (!branch) throw new NotFoundError('Branch', branchId);
      if (branch.status !== 'active') validationError('That branch is closed');
    }
    await this.repo.insertNote(scopeName, note.trim(), branchId ?? null, getUserId() ?? null);
    return { ok: true };
  }
  notes(scopeName: 'dispatch' | 'branch', branchId?: string) {
    return this.repo.notes(scopeName, branchId ?? null);
  }

  /* ── dispatch reports (597–603) ── */
  async dispatchReport(from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
      validationError('from/to must be YYYY-MM-DD with from ≤ to');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= MAX_REPORT_DAYS)
      validationError(`Pick a period of at most ${MAX_REPORT_DAYS} days`);
    const [summary, delayed, buses, crew] = await Promise.all([
      this.repo.dispatchSummary(from, to),
      this.repo.delayedTrips(from, to),
      this.repo.busUtilisation(from, to),
      this.repo.crewPerformance(from, to),
    ]);
    const s = summary ?? {};
    const onTimePct = s.tripsWithActuals
      ? Math.round(((s.onTime ?? 0) / Number(s.tripsWithActuals)) * 1000) / 10
      : null;
    return { period: { from, to }, summary: { ...s, onTimePct }, delayed, buses, crew };
  }
}
