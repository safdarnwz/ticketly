import { Injectable } from '@nestjs/common';

import { Permission } from '@contracts';
import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  DomainError,
  ErrorCode,
  ForbiddenError,
  getUserId,
  hasPermission,
  newId,
  NotFoundError,
  requireTenantId,
  type CrewId,
  type DutyId,
  type TripId,
  type UserId,
} from '@kernel';
import { EventBus } from '@messaging';
import { PasswordHasher } from '@security';

import { BookingRepository } from '../../../booking';
import { CrewRepository, CrewService } from '../../../fleet';
import { RoleRepository, SessionRepository, User, UserRepository } from '../../../iam';
import { PlatformPoliciesService } from '../../../platform-settings';
import { TripRepository } from '../../../scheduling';

/** The crew role: the crew app only (a login cannot open the operator console). */
const CREW_ROLE_PERMISSIONS = [Permission.CREW_APP];
/** "My day": duties from 12 hours ago to 30 days ahead (the roster is planned weeks out). */
const DUTY_WINDOW_BACK_MS = 12 * 3_600_000;
const DUTY_WINDOW_AHEAD_MS = 30 * 24 * 3_600_000;

/**
 * Crew/driver app backend.
 *
 *  - **manifest** — the passenger list for a trip (seat, name, boarding/dropping
 *    points), read by the conductor at each stop.
 *  - **boarding scan** — validate a ticket's boarding code and mark the
 *    passenger boarded. Idempotent: scanning an already-boarded ticket returns
 *    its state rather than erroring, and a ticket for a different trip or a
 *    cancelled booking is rejected — the guard against a forged or reused QR.
 *  - **trip start/stop** — the driver flips the trip's operational status,
 *    which feeds live tracking.
 */
/** How early before its scheduled time a bus may be marked departed. */
const DEPART_EARLIEST_MS = 2 * 3_600_000;

@Injectable()
export class CrewAppService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly trips: TripRepository,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    private readonly crew: CrewRepository,
    private readonly crewService: CrewService,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly policies: PlatformPoliciesService,
  ) {}

  // ── the crew member behind a crew-app login ──

  /** The signed-in crew member; a login that is not a crew member's, or crew who are not active, is refused. */
  async me() {
    const userId = getUserId();
    const me = userId ? await this.crew.findByUserId(userId) : null;
    if (!me) throw new ForbiddenError({ message: 'This login is not linked to a crew member' });
    if (me.status !== 'active')
      throw new ForbiddenError({
        message: `You are marked ${me.status.replace('_', ' ')} — ask the depot to change it`,
      });
    return me;
  }

  /** My duties from earlier today to a week ahead, each with its trip. */
  async myDay() {
    const me = await this.me();
    const now = Date.now();
    const duties = await this.crew.myDuties(
      me.id,
      new Date(now - DUTY_WINDOW_BACK_MS),
      new Date(now + DUTY_WINDOW_AHEAD_MS),
    );
    return { crew: me, duties };
  }

  /** I mark myself present for one of my duties (late after 15 minutes, as for the depot). */
  async markMyAttendance(dutyId: string) {
    const me = await this.me();
    const now = Date.now();
    const mine = await this.crew.myDuties(
      me.id,
      new Date(now - 7 * 86_400_000),
      new Date(now + DUTY_WINDOW_AHEAD_MS),
    );
    if (!mine.some((d) => d.id === dutyId)) throw new NotFoundError('Duty', dutyId);
    return this.crewService.markAttendance(dutyId as DutyId, 'present');
  }

  /**
   * Staff who run trips may act on any trip of the operator; a crew login only
   * on a trip they are on duty for (404 otherwise — never a hint it exists).
   */
  async assertOnTrip(tripId: string): Promise<void> {
    if (hasPermission(Permission.TRIP_OPERATE)) return;
    const me = await this.me();
    if (!(await this.crew.isOnTrip(me.id, tripId))) throw new NotFoundError('Trip', tripId);
  }

  /**
   * The operator gives a crew member a login (their mobile + this password) or
   * resets it; the crew member signs in to the crew app with it.
   */
  async setLogin(crewId: string, password: string): Promise<{ userId: string; created: boolean }> {
    const tenantId = requireTenantId();
    const member = await this.crew.getById(crewId as CrewId);
    if (!member.phone)
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Add a mobile number first — it is the login',
      );
    await this.policies.assertPasswordAcceptable(password);
    const hash = await this.hasher.hash(password);
    const linked = await this.crew.loginUserId(member.id);
    if (linked) {
      await this.uow.run({ name: 'crew.resetLogin', tenantId }, async () => {
        const user = await this.users.findById(linked as UserId);
        if (!user) throw new NotFoundError('User', linked);
        user.setPassword(hash);
        user.unlock();
        await this.users.update(user, user.version);
        await this.sessions.revokeAllForUser(user.id, 'password-reset-by-admin');
      });
      await this.roles.invalidateUser(linked as UserId);
      return { userId: linked, created: false };
    }
    const taken = await this.users.findByPhoneGlobal(member.phone);
    if (taken) throw new ConflictError('Another account already signs in with this mobile number');
    return this.uow.run({ name: 'crew.createLogin', tenantId }, async () => {
      const user = User.create(newId() as UserId, {
        tenantId,
        kind: 'staff',
        fullName: member.fullName,
        phone: member.phone,
        passwordHash: hash,
        status: 'active',
      });
      await this.users.insert(user);
      const role =
        (await this.roles.findByCode('crew'))?.id ??
        (await this.roles.createRole({
          tenantId,
          code: 'crew',
          name: 'Crew (driver / conductor)',
          description: 'Crew app only',
          isSystem: true,
          permissions: CREW_ROLE_PERMISSIONS,
        }));
      await this.roles.grantToUser(user.id, role, getUserId() ?? null);
      await this.crew.linkLogin(member.id, user.id);
      return { userId: user.id, created: true };
    });
  }

  async manifest(tripId: TripId): Promise<unknown[]> {
    await this.assertOnTrip(tripId);
    return this.bookings.manifest(tripId);
  }

  /** Board a passenger from the manifest after checking their PNR / ID — same rules as a scan. */
  async boardTicket(tripId: TripId, ticketId: string) {
    await this.assertOnTrip(tripId);
    return this.uow.run({ name: 'crew.boardTicket', tenantId: requireTenantId() }, async () =>
      this.markBoarded(tripId, await this.bookings.lockTicketById(ticketId)),
    );
  }

  /** Validate a boarding code and mark boarded. Idempotent + anti-forgery. */
  async scanBoarding(
    tripId: TripId,
    boardingCode: string,
  ): Promise<{ status: string; seatNumber: string; passenger?: string }> {
    await this.assertOnTrip(tripId);
    return this.uow.run({ name: 'crew.scanBoarding', tenantId: requireTenantId() }, async () =>
      this.markBoarded(
        tripId,
        await this.bookings.lockTicketByBoardingCode(boardingCode.trim().toUpperCase()),
      ),
    );
  }

  private async markBoarded(
    tripId: TripId,
    ticket: Awaited<ReturnType<BookingRepository['lockTicketById']>>,
  ): Promise<{ status: string; seatNumber: string; passenger?: string }> {
    if (!ticket)
      throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, { message: 'Invalid boarding code' });
    if (ticket.tripId !== tripId) {
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'This ticket is for a different trip',
      });
    }
    if (ticket.bookingStatus !== 'confirmed') {
      throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
        message: 'Booking is not confirmed',
      });
    }
    const passenger = ticket.passengerName ?? undefined;
    // Idempotent: already boarded → return state, don't error.
    if (ticket.status === 'boarded')
      return { status: 'already_boarded', seatNumber: ticket.seatNumber, passenger };
    if (ticket.status === 'cancelled')
      throw new AppError(ErrorCode.COMMON_CONFLICT, 422, { message: 'Ticket is cancelled' });

    await this.bookings.setTicketStatus(ticket.id, 'boarded');
    this.events.publish({
      type: 'passenger.boarded',
      aggregateType: 'ticket',
      aggregateId: ticket.id,
      payload: { tripId, seat: ticket.seatNumber },
    });
    return { status: 'boarded', seatNumber: ticket.seatNumber, passenger };
  }

  async setTripStatus(tripId: TripId, status: 'departed' | 'closed'): Promise<void> {
    await this.assertOnTrip(tripId);
    await this.uow.run({ name: 'crew.setTripStatus', tenantId: requireTenantId() }, async () => {
      // A doubled tap or a retried request must not re-fire 'trip.departed'.
      const current = await this.trips.getById(tripId);
      if (current.status === status) return;
      if (current.status === 'cancelled')
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'This trip was cancelled',
        });
      // Closing is the end of the journey: only a bus that left can arrive.
      if (status === 'closed' && current.status !== 'departed')
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'Mark the bus departed before closing the trip',
        });
      // A bus leaves around its time: marking next week's bus departed by
      // mistake would stop its sales and tell its passengers it has gone.
      if (status === 'departed' && current.departsAt.getTime() - Date.now() > DEPART_EARLIEST_MS)
        throw new AppError(ErrorCode.BOOKING_INVALID_STATE, 422, {
          message: 'A bus can be marked departed from 2 hours before its departure time',
        });
      await this.trips.setStatus(tripId, status);
      if (status === 'departed')
        this.events.publish({
          type: 'trip.departed',
          aggregateType: 'trip',
          aggregateId: tripId,
          payload: {},
        });
    });
  }
}
