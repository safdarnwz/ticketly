import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { EventBus } from '@messaging';
import {
  ConflictError,
  DomainError,
  ErrorCode,
  getUserId,
  NotFoundError,
  requireTenantId,
  type CrewId,
  type DutyId,
  type TripId,
} from '@kernel';

import {
  assertAssignable,
  checkAssignment,
  isOverridable,
  remainingAllowance,
  resolveAttendance,
  type Duty,
  type RestRules,
} from '../../domain/duty-roster';
import { CrewRepository } from '../../infrastructure/persistence/crew.repository';

const MS_PER_DAY = 86_400_000;

/**
 * Crew service — assignment with full conflict checking.
 *
 * `assignDuty` runs the DutyRoster domain rules (overlap, rest, driving cap)
 * inside a transaction, then inserts. The database exclusion constraint is the
 * concurrency backstop: if two schedulers assign the same driver at the same
 * instant, one INSERT loses and surfaces as a 409, so a driver is never
 * physically double-booked even under a race the application check can't see.
 */
@Injectable()
export class CrewService {
  constructor(
    private readonly crew: CrewRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
  ) {}

  /**
   * Assign a crew member to a duty. Checked against the operator's rest
   * rules (overlap, rest gap, 24h driving cap, duty length, continuous
   * driving). A manager may APPROVE a breach of the rest/driving/length rules
   * (e.g. an emergency double duty) by giving a reason — it is recorded with
   * the exact rules it broke for the compliance view. Overlaps can never be
   * approved.
   */
  async assignDuty(input: {
    crewId: CrewId;
    tripId: TripId | null;
    startsAt: Date;
    endsAt: Date;
    drivingMinutes: number;
    rules?: RestRules;
    override?: { reason: string };
  }): Promise<DutyId> {
    const candidate: Duty = {
      id: 'candidate',
      crewId: input.crewId,
      startMs: input.startsAt.getTime(),
      endMs: input.endsAt.getTime(),
      drivingMinutes: input.drivingMinutes,
    };
    return this.uow.run({ name: 'crew.assignDuty', tenantId: requireTenantId() }, async () => {
      const member = await this.crew.getById(input.crewId); // 404 for another operator's crew
      if (member.status !== 'active')
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          member.status === 'on_leave'
            ? `${member.fullName} is on leave and cannot be given a duty`
            : `${member.fullName} is inactive and cannot be given a duty`,
        );
      if (member.role === 'driver') {
        const lastDay = input.endsAt.toISOString().slice(0, 10);
        if (!member.licenceExpiresOn)
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            `${member.fullName} has no driving licence on file — add it before giving a duty`,
          );
        if (member.licenceExpiresOn < lastDay)
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            `${member.fullName}'s driving licence expires on ${member.licenceExpiresOn}, before this duty ends`,
          );
      }
      if (input.tripId) {
        const trip = await this.crew.tripForDuty(input.tripId);
        if (!trip) throw new NotFoundError('Trip', input.tripId);
        if (trip.status === 'cancelled')
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            'That trip is cancelled — it needs no crew',
          );
      }
      const rules = input.rules ?? (await this.crew.loadRules());
      const existing = await this.crew.loadDuties(
        input.crewId,
        candidate.startMs - MS_PER_DAY,
        candidate.endMs + MS_PER_DAY,
      );
      const check = checkAssignment(candidate, existing, rules);
      let override: { reason: string; conflicts: unknown[]; approvedBy: string | null } | undefined;
      if (!check.ok) {
        const reason = input.override?.reason?.trim() ?? '';
        if (!reason || !isOverridable(check.conflicts))
          assertAssignable(candidate, existing, rules); // throws the precise conflicts
        if (reason.length < 10)
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            'Explain why this exception is approved (at least 10 characters)',
          );
        override = { reason, conflicts: check.conflicts, approvedBy: getUserId() ?? null };
      }
      try {
        return await this.crew.insertDuty({
          crewId: input.crewId,
          tripId: input.tripId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          drivingMinutes: input.drivingMinutes,
          override,
        });
      } catch (error) {
        if (error instanceof ConflictError)
          throw new ConflictError(
            'Crew was assigned to an overlapping duty by a concurrent request',
          );
        throw error;
      }
    });
  }

  /** Mark attendance for a duty; an absent crew member raises crew.absent so dispatch can assign a replacement. */
  async markAttendance(
    dutyId: DutyId,
    requested: 'present' | 'absent',
  ): Promise<{ attendance: string }> {
    return this.uow.run({ name: 'crew.attendance', tenantId: requireTenantId() }, async () => {
      const d = await this.crew.dutyForUpdate(dutyId);
      if (!d) throw new NotFoundError('Duty', dutyId);
      if (d.status === 'cancelled')
        throw new DomainError(ErrorCode.COMMON_VALIDATION, 'This duty was cancelled');
      let attendance: string;
      try {
        attendance = resolveAttendance({
          requested,
          dutyStartMs: d.startsAt.getTime(),
          dutyEndMs: d.endsAt.getTime(),
          markedAtMs: Date.now(),
        });
      } catch (e) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          e instanceof Error ? e.message : 'Cannot mark attendance',
        );
      }
      await this.crew.setAttendance(dutyId, attendance, getUserId() ?? null);
      if (attendance === 'absent' && d.attendance !== 'absent') {
        this.events.publish({
          type: 'crew.absent',
          aggregateType: 'crew',
          aggregateId: d.crewId,
          payload: { dutyId, tripId: d.tripId, startsAt: d.startsAt.toISOString() },
        });
      }
      return { attendance };
    });
  }

  /** Driving still allowed now in the rolling 24h window, and when the crew member is next rested. */
  async allowance(crewId: CrewId) {
    await this.crew.getById(crewId);
    const now = Date.now();
    const [rules, duties] = await Promise.all([
      this.crew.loadRules(),
      this.crew.loadDuties(crewId, now - 2 * MS_PER_DAY, now),
    ]);
    const r = remainingAllowance(duties, now, rules);
    return {
      remainingDrivingMinutes: r.remainingDrivingMinutes,
      nextAvailableAt: r.nextAvailableAtMs ? new Date(r.nextAvailableAtMs).toISOString() : null,
      rules,
    };
  }

  async rules() {
    return this.crew.loadRules();
  }

  async setRules(r: RestRules) {
    if (r.maxDutyMinutes < (r.maxContinuousDrivingMinutes ?? 0))
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Continuous driving limit cannot exceed the duty length limit',
      );
    await this.crew.saveRules(r, getUserId() ?? null);
  }

  compliance(from: string, to: string) {
    return this.crew.compliance(from, to);
  }

  /** Cancel a duty that has not started yet and was not marked — a done duty is history. */
  async cancelDuty(id: DutyId): Promise<void> {
    await this.uow.run({ name: 'crew.cancelDuty', tenantId: requireTenantId() }, async () => {
      const d = await this.crew.dutyForUpdate(id);
      if (!d) throw new NotFoundError('Duty', id);
      if (d.status === 'cancelled') return; // already cancelled: a retry is a no-op
      if (d.attendance !== 'pending')
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'Attendance is already marked for this duty — it cannot be cancelled',
        );
      if (d.endsAt.getTime() <= Date.now())
        throw new DomainError(ErrorCode.COMMON_VALIDATION, 'This duty has already ended');
      await this.crew.cancelDuty(id);
    });
  }

  /** Add a crew member. One mobile belongs to one person in the team. */
  async addCrew(input: Parameters<CrewRepository['create']>[0]): Promise<CrewId> {
    return this.uow.run({ name: 'crew.add', tenantId: requireTenantId() }, async () => {
      await this.assertPhoneFree(input.phone);
      return this.crew.create(input);
    });
  }

  /**
   * Edit a crew member. Going on leave or inactive is refused while they
   * still hold upcoming duties — hand those to someone else first; a driver
   * keeps a licence on file.
   */
  async updateCrew(id: CrewId, patch: Parameters<CrewRepository['update']>[1]): Promise<void> {
    await this.uow.run({ name: 'crew.update', tenantId: requireTenantId() }, async () => {
      const member = await this.crew.getById(id, true);
      if (patch.phone) await this.assertPhoneFree(patch.phone, id);
      if (member.role === 'driver' && (patch.licenceNo === null || patch.licenceExpiresOn === null))
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          'A driver needs a licence number and its expiry date',
        );
      if (patch.status && patch.status !== 'active' && member.upcomingDuties > 0)
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          `${member.fullName} still has ${member.upcomingDuties} upcoming ${member.upcomingDuties === 1 ? 'duty' : 'duties'} — cancel or reassign them first`,
        );
      await this.crew.update(id, patch);
    });
  }

  private async assertPhoneFree(phone: string | undefined | null, except?: CrewId) {
    if (!phone) return;
    const holder = await this.crew.phoneTakenBy(phone, except);
    if (holder) throw new ConflictError(`This mobile already belongs to ${holder} in your crew`);
  }
}
