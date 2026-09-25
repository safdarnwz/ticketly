import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  AppError,
  ConflictError,
  DomainError,
  ErrorCode,
  ForbiddenError,
  NotFoundError,
  getUserId,
  newId,
  requireTenantId,
  type AgentId,
  type BookingId,
  type RoleId,
  type UserId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger } from '@observability';
import { PasswordHasher } from '@security';

import { BookingService, BookingRepository, type HoldRequest } from '../../../booking';
import { PaymentService } from '../../../payment';
import { SeatQuotaService } from '../../../quotas';
import { User, RoleRepository, UserRepository } from '../../../iam';
import {
  agentCommissionMinor,
  canTransition,
  checkFunds,
  isLowBalance,
  spendableMinor,
  validateTerms,
  type AgentStatus,
  type BillingMode,
} from '../../domain/agent-account';
import { AgentRepository, type Agent } from '../../infrastructure/persistence/agent.repository';
import {
  monthStart,
  rateFor,
  SlabRuleError,
  validateSlabs,
  type Slab,
} from '../../domain/commission-slabs';
import { resolveAgentCreditLimit, PlatformPoliciesService } from '../../../platform-settings';

export interface CreateAgentRequest {
  name: string;
  code?: string;
  contactName?: string;
  contactPhone: string;
  contactEmail?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  city?: string;
  branchId?: string;
  billingMode: BillingMode;
  commissionPct: number;
  creditLimitMinor?: number;
  lowBalanceAlertMinor?: number;
  paymentTermsDays?: number;
  /** Agent's login. */
  loginEmail: string;
  password: string;
  /** Operator-created agents are usually trusted immediately. */
  activate?: boolean;
}

const AGENT_ROLE_PERMISSIONS = ['agent:portal'];

/**
 * ============================================================================
 *  B2B agent network
 * ============================================================================
 *
 * OPERATOR side  — onboard agents (with their own login), approve/suspend,
 *                  set billing terms, record deposits (prepaid) and payments
 *                  received (postpaid), manual adjustments, statements.
 *
 * AGENT side     — book seats for walk-in passengers against their own
 *                  account, cancel their own bookings, see their ledger.
 *
 * SELLING (agentBook): hold → [one transaction: lock agent row, check funds,
 * debit full ticket value, credit commission] → confirm via
 * PaymentService.confirmAgentBooking (offline ledger capture). The debit is
 * committed BEFORE the confirm so two concurrent sales can never both pass
 * the funds check; if the confirm then fails, the debit is reversed with a
 * `booking_reversal` line — the agent is never charged for a ticket that
 * wasn't issued, and the balance is never silently wrong.
 *
 * REFUNDS for agent bookings are credited back to the agent's account by
 * RefundService via AgentRefundService — the operator holds the cash, so a
 * gateway refund would be both impossible and the wrong actor.
 */
@Injectable()
export class AgentService {
  private readonly log: Logger;

  constructor(
    private readonly agents: AgentRepository,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly hasher: PasswordHasher,
    private readonly bookingService: BookingService,
    private readonly bookings: BookingRepository,
    private readonly payments: PaymentService,
    private readonly quotas: SeatQuotaService,
    private readonly uow: UnitOfWork,
    private readonly events: EventBus,
    logger: Logger,
    private readonly policies: PlatformPoliciesService,
  ) {
    this.log = logger.forContext('AgentService');
  }

  /* ───────────────────────── operator: onboarding ───────────────────────── */

  async create(
    input: CreateAgentRequest,
  ): Promise<{ agentId: AgentId; userId: UserId; code: string }> {
    const tenantId = requireTenantId();
    const credit = resolveAgentCreditLimit(
      await this.policies.agentCreditPolicy(),
      input.billingMode,
      input.creditLimitMinor,
    );
    if (!credit.ok) throw new DomainError(ErrorCode.COMMON_VALIDATION, credit.error);
    const creditLimitMinor = credit.creditLimitMinor;
    const termsError = validateTerms({ billingMode: input.billingMode, creditLimitMinor });
    if (termsError) throw new DomainError(ErrorCode.COMMON_VALIDATION, termsError);

    const email = input.loginEmail.trim().toLowerCase();
    if (await this.users.findByEmail(email))
      throw new ConflictError('A user with this login email already exists');

    const code = (input.code?.trim() || this.suggestCode(input.name)).toUpperCase();
    if (await this.agents.codeExists(code))
      throw new ConflictError(`Agent code '${code}' is already in use`);

    await this.policies.assertPasswordAcceptable(input.password);
    const passwordHash = await this.hasher.hash(input.password);

    return this.uow.run({ name: 'agent.create', tenantId }, async () => {
      const user = User.create(newId() as UserId, {
        tenantId,
        kind: 'staff',
        fullName: input.contactName?.trim() || input.name,
        email,
        phone: input.contactPhone,
        passwordHash,
        status: 'active',
      });
      await this.users.insert(user);
      const roleId = await this.ensureAgentRole();
      await this.roles.grantToUser(user.id, roleId, getUserId() ?? null);

      const agentId = await this.agents.create({
        userId: user.id,
        code,
        name: input.name.trim(),
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactEmail: input.contactEmail ?? email,
        gstin: input.gstin,
        pan: input.pan,
        address: input.address,
        city: input.city,
        branchId: input.branchId,
        status: input.activate === false ? 'pending' : 'active',
        billingMode: input.billingMode,
        commissionPct: input.commissionPct,
        creditLimitMinor,
        lowBalanceAlertMinor: input.lowBalanceAlertMinor ?? 0,
        paymentTermsDays: input.paymentTermsDays ?? 7,
      });
      this.events.publish({
        type: 'agent.created',
        aggregateType: 'agent',
        aggregateId: agentId,
        payload: { code, billingMode: input.billingMode },
      });
      return { agentId, userId: user.id, code };
    });
  }

  async list(filter: { status?: AgentStatus; search?: string } = {}): Promise<
    (Agent & {
      spendableMinor: number;
      lowBalance: boolean;
      bookings: number;
      salesMinor: number;
      commissionMinor: number;
    })[]
  > {
    const [items, summary] = await Promise.all([this.agents.list(filter), this.agents.summary()]);
    const byId = new Map(summary.map((s) => [s.agentId, s]));
    return items.map((a) => ({
      ...a,
      spendableMinor: spendableMinor(a.balanceMinor, a.creditLimitMinor),
      lowBalance: isLowBalance(a.balanceMinor, a.creditLimitMinor, a.lowBalanceAlertMinor),
      bookings: byId.get(a.id)?.bookings ?? 0,
      salesMinor: byId.get(a.id)?.salesMinor ?? 0,
      commissionMinor: byId.get(a.id)?.commissionMinor ?? 0,
    }));
  }

  async get(id: AgentId): Promise<Agent & { spendableMinor: number; lowBalance: boolean }> {
    const agent = await this.agents.getById(id);
    if (!agent) throw new NotFoundError('Agent', id);
    return this.decorate(agent);
  }

  async update(id: AgentId, input: Parameters<AgentRepository['update']>[1]): Promise<void> {
    await this.uow.run({ name: 'agent.update', tenantId: requireTenantId() }, async () => {
      const agent = await this.agents.lockForUpdate(id);
      if (!agent) throw new NotFoundError('Agent', id);
      const billingMode = input.billingMode ?? agent.billingMode;
      const creditLimitMinor =
        billingMode === 'prepaid' ? 0 : (input.creditLimitMinor ?? agent.creditLimitMinor);
      const termsError = validateTerms({
        billingMode,
        creditLimitMinor,
        balanceMinor: agent.balanceMinor,
      });
      if (termsError) throw new DomainError(ErrorCode.COMMON_VALIDATION, termsError);
      await this.agents.update(id, { ...input, billingMode, creditLimitMinor });
    });
  }

  async setStatus(id: AgentId, to: AgentStatus, reason?: string): Promise<void> {
    await this.uow.run({ name: 'agent.setStatus', tenantId: requireTenantId() }, async () => {
      const agent = await this.agents.lockForUpdate(id);
      if (!agent) throw new NotFoundError('Agent', id);
      if (agent.status === to) return;
      if (!canTransition(agent.status, to)) {
        throw new DomainError(
          ErrorCode.COMMON_VALIDATION,
          `An agent cannot go from ${agent.status} to ${to}`,
        );
      }
      await this.agents.setStatus(id, to, reason ?? null);
      this.events.publish({
        type: `agent.${to}`,
        aggregateType: 'agent',
        aggregateId: id,
        payload: { reason: reason ?? null },
      });
    });
  }

  /* ───────────────────────── operator: money in ─────────────────────────── */

  /**
   * Record money received FROM the agent: a prepaid top-up ('deposit') or a
   * postpaid statement payment ('payment_received'). `reference` (receipt /
   * UTR number) makes a double-submitted form a no-op.
   */
  async recordReceipt(
    id: AgentId,
    input: { amountMinor: number; reference: string; note?: string },
  ): Promise<{ balanceMinor: number; applied: boolean }> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Amount must be a positive whole number of paise',
      );
    }
    return this.uow.run({ name: 'agent.receipt', tenantId: requireTenantId() }, async () => {
      const agent = await this.agents.lockForUpdate(id);
      if (!agent) throw new NotFoundError('Agent', id);
      if (agent.status === 'rejected')
        throw new DomainError(
          ErrorCode.AGENT_NOT_ACTIVE,
          'Cannot record money for a rejected agent',
        );
      const kind = agent.billingMode === 'prepaid' ? 'deposit' : 'payment_received';
      const res = await this.agents.post({
        agentId: id,
        kind,
        magnitudeMinor: input.amountMinor,
        reference: `receipt:${input.reference.trim()}`,
        note: input.note ?? null,
        createdBy: getUserId() ?? null,
      });
      const fresh = await this.agents.getById(id);
      return { balanceMinor: fresh?.balanceMinor ?? agent.balanceMinor, applied: res.applied };
    });
  }

  /** Signed manual correction; a reason is mandatory, and it can never breach the limit. */
  async adjust(
    id: AgentId,
    input: { amountMinor: number; reason: string; reference?: string },
  ): Promise<{ balanceMinor: number }> {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor === 0) {
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'Adjustment must be a non-zero whole number of paise',
      );
    }
    if (!input.reason?.trim())
      throw new DomainError(
        ErrorCode.COMMON_VALIDATION,
        'A reason is required for every adjustment',
      );
    return this.uow.run({ name: 'agent.adjust', tenantId: requireTenantId() }, async () => {
      const agent = await this.agents.lockForUpdate(id);
      if (!agent) throw new NotFoundError('Agent', id);
      if (spendableMinor(agent.balanceMinor + input.amountMinor, agent.creditLimitMinor) < 0) {
        throw new DomainError(
          ErrorCode.AGENT_INSUFFICIENT_FUNDS,
          'This adjustment would take the agent past their credit limit',
        );
      }
      await this.agents.post({
        agentId: id,
        kind: 'adjustment',
        magnitudeMinor: input.amountMinor,
        reference: input.reference ? `adj:${input.reference}` : `adj:${newId()}`,
        note: input.reason.trim(),
        createdBy: getUserId() ?? null,
      });
      return { balanceMinor: agent.balanceMinor + input.amountMinor };
    });
  }

  ledger(id: AgentId, opts: { from?: string; to?: string; limit?: number }) {
    return this.agents.ledger(id, opts);
  }

  async statement(id: AgentId, from: string, to: string) {
    const agent = await this.get(id);
    const figures = await this.agents.statement(id, from, to);
    const salesMinor =
      -(figures.totals.booking_debit ?? 0) - (figures.totals.booking_reversal ?? 0);
    const refundsMinor = figures.totals.refund_credit ?? 0;
    const commissionMinor =
      (figures.totals.commission_credit ?? 0) + (figures.totals.commission_reversal ?? 0);
    const receivedMinor = (figures.totals.deposit ?? 0) + (figures.totals.payment_received ?? 0);
    return {
      agent: {
        id: agent.id,
        code: agent.code,
        name: agent.name,
        billingMode: agent.billingMode,
        creditLimitMinor: agent.creditLimitMinor,
        paymentTermsDays: agent.paymentTermsDays,
      },
      period: { from, to },
      openingBalanceMinor: figures.openingMinor,
      salesMinor,
      refundsMinor,
      commissionMinor,
      receivedMinor,
      adjustmentsMinor: figures.totals.adjustment ?? 0,
      closingBalanceMinor: figures.closingMinor,
      // Postpaid: a negative closing balance is what the agent owes.
      amountDueMinor: agent.billingMode === 'postpaid' ? Math.max(0, -figures.closingMinor) : 0,
      bookings: figures.bookings,
    };
  }

  /* ───────────────────────── agent: self-service ────────────────────────── */

  /** Commission % the agent's NEXT ticket earns (slabs → operator default → flat). */
  async currentRate(
    agentId: AgentId,
    flatPct: number,
  ): Promise<{
    pct: number;
    source: 'agent_slab' | 'operator_slab' | 'flat';
    monthSalesMinor: number;
  }> {
    const [slabs, monthSalesMinor] = await Promise.all([
      this.agents.slabsFor(agentId),
      this.agents.monthSales(agentId, monthStart(new Date())),
    ]);
    return {
      ...rateFor({
        agentSlabs: slabs.agent,
        operatorSlabs: slabs.operator,
        flatPct,
        monthSalesMinor,
      }),
      monthSalesMinor,
    };
  }

  async getSlabs(agentId: AgentId | null) {
    if (agentId) await this.get(agentId);
    const s = await this.agents.slabsFor(agentId);
    return agentId
      ? { agentSlabs: s.agent, operatorDefaultSlabs: s.operator }
      : { operatorDefaultSlabs: s.operator };
  }

  /** Replace a slab table; an empty list removes it (falls back to the next level). */
  async setSlabs(agentId: AgentId | null, slabs: Slab[]): Promise<void> {
    let clean: Slab[] = [];
    if (slabs.length) {
      try {
        clean = validateSlabs(slabs);
      } catch (e) {
        if (e instanceof SlabRuleError)
          throw new DomainError(ErrorCode.COMMON_VALIDATION, e.message);
        throw e;
      }
    }
    await this.uow.run({ name: 'agent.setSlabs', tenantId: requireTenantId() }, async () => {
      if (agentId) {
        const a = await this.agents.lockForUpdate(agentId);
        if (!a) throw new NotFoundError('Agent', agentId);
      }
      await this.agents.replaceSlabs(agentId, clean);
    });
  }

  /** The agent record for the logged-in user — the ONLY way a portal call learns "who am I". */
  async me(): Promise<Agent & { spendableMinor: number; lowBalance: boolean }> {
    const userId = getUserId();
    if (!userId) throw new ForbiddenError({ message: 'Not signed in as an agent' });
    const agent = await this.agents.findByUserId(userId);
    if (!agent)
      throw new ForbiddenError({ message: 'This login is not linked to an agent account' });
    return this.decorate(agent);
  }

  async myBookings(opts: { status?: string; limit?: number }) {
    const agent = await this.me();
    return this.agents.bookings(agent.id, opts);
  }

  /** Throws 404 unless the booking was sold by the logged-in agent (same 404 as "doesn't exist"). */
  async assertMyBooking(bookingId: BookingId): Promise<void> {
    const me = await this.me();
    if ((await this.agents.agentForBooking(bookingId)) !== me.id)
      throw new NotFoundError('Booking', bookingId);
  }

  async myBookingsInPeriod(from?: string, to?: string) {
    const me = await this.me();
    return this.bookings.search({ agentId: me.id, from, to });
  }

  async myBooking(bookingId: BookingId) {
    const agent = await this.me();
    await this.assertOwns(agent.id, bookingId);
    const booking = await this.bookings.findForUpdate(bookingId);
    const [passengers, tickets] = await Promise.all([
      this.bookings.loadPassengers(bookingId),
      this.bookings.listTickets(bookingId),
    ]);
    return { booking, passengers, tickets };
  }

  /**
   * Sell seats as an agent. See the class doc for why the debit commits
   * before the confirm and how a failed confirm is reversed.
   */
  async agentBook(req: Omit<HoldRequest, 'channel'>): Promise<{
    bookingId: BookingId;
    pnr: string;
    totalMinor: number;
    commissionMinor: number;
    balanceMinor: number;
  }> {
    const agent = await this.me();
    if (agent.status !== 'active') {
      throw new DomainError(
        ErrorCode.AGENT_NOT_ACTIVE,
        `Your agent account is ${agent.status} — contact the operator`,
      );
    }

    // Seats in THIS agent's quota are freed inside the hold transaction
    // (atomic — nobody can grab them in between); seats in anyone else's
    // quota stay blocked and the hold fails as unavailable, as it must.
    const held = await this.bookingService.hold(
      { ...req, channel: 'agent' },
      {
        beforeLock: async (tripId, seats) => {
          await this.quotas.consumeForHolder(tripId, seats, 'agent', agent.id);
        },
      },
    );
    const bookingId = held.bookingId;

    const debit = await this.uow
      .run({ name: 'agent.book.debit', tenantId: requireTenantId() }, async () => {
        const locked = await this.agents.lockForUpdate(agent.id);
        if (!locked || locked.status !== 'active')
          throw new DomainError(ErrorCode.AGENT_NOT_ACTIVE, 'Agent account is not active');
        const booking = await this.bookings.findForUpdate(bookingId);
        if (!booking) throw new NotFoundError('Booking', bookingId);

        // Volume slab decided by month-to-date net sales BEFORE this ticket
        // (the agent row lock above serialises this agent's concurrent sales).
        const rate = await this.currentRate(locked.id, locked.commissionPct);
        const commissionMinor = agentCommissionMinor(
          booking.totalMinor,
          booking.taxMinor,
          rate.pct,
        );
        const funds = checkFunds({
          balanceMinor: locked.balanceMinor,
          creditLimitMinor: locked.creditLimitMinor,
          totalMinor: booking.totalMinor,
          commissionMinor,
        });
        if (!funds.ok) {
          throw new AppError(ErrorCode.AGENT_INSUFFICIENT_FUNDS, 402, {
            message:
              locked.billingMode === 'prepaid'
                ? `Insufficient balance — top up at least ₹${(funds.shortfallMinor / 100).toFixed(2)} with the operator`
                : `Credit limit reached — pay ₹${(funds.shortfallMinor / 100).toFixed(2)} of your outstanding to continue`,
            details: { shortfallMinor: funds.shortfallMinor },
          });
        }

        await this.agents.setBookingAgent(bookingId, agent.id);
        await this.agents.post({
          agentId: agent.id,
          kind: 'booking_debit',
          magnitudeMinor: booking.totalMinor,
          bookingId,
          reference: `booking:${bookingId}`,
          note: booking.pnr,
          createdBy: agent.userId,
        });
        if (commissionMinor > 0) {
          await this.agents.post({
            agentId: agent.id,
            kind: 'commission_credit',
            magnitudeMinor: commissionMinor,
            bookingId,
            reference: `booking:${bookingId}`,
            note: `${rate.pct}% on net fare (${rate.source.replace('_', ' ')})`,
            createdBy: agent.userId,
          });
        }
        return { totalMinor: booking.totalMinor, commissionMinor };
      })
      .catch(async (e: unknown) => {
        // Funds/status failure: free the seats now instead of waiting for the hold TTL.
        await this.bookingService.cancel(bookingId, 'agent sale not funded').catch(() => undefined);
        throw e;
      });

    let pnr: string;
    try {
      ({ pnr } = await this.payments.confirmAgentBooking(bookingId, agent.id));
    } catch (e) {
      this.log.error(
        { bookingId, agentId: agent.id, err: (e as Error).message },
        'agent sale confirm failed after debit — reversing',
      );
      await this.uow.run({ name: 'agent.book.reverse', tenantId: requireTenantId() }, async () => {
        await this.agents.lockForUpdate(agent.id);
        await this.agents.post({
          agentId: agent.id,
          kind: 'booking_reversal',
          magnitudeMinor: debit.totalMinor,
          bookingId,
          reference: `booking:${bookingId}`,
          note: 'ticket not issued',
        });
        if (debit.commissionMinor > 0) {
          await this.agents.post({
            agentId: agent.id,
            kind: 'commission_reversal',
            magnitudeMinor: debit.commissionMinor,
            bookingId,
            reference: `booking:${bookingId}`,
            note: 'ticket not issued',
          });
        }
      });
      throw e;
    }

    // The ticket is issued at this point — a failing low-balance alert must
    // never turn a successful sale into an error for the agent. publish()
    // only works inside a transaction (outbox), hence its own small uow.
    const after = await this.agents.getById(agent.id);
    if (
      after &&
      isLowBalance(after.balanceMinor, after.creditLimitMinor, after.lowBalanceAlertMinor)
    ) {
      await this.uow
        .run({ name: 'agent.lowBalanceAlert', tenantId: requireTenantId() }, async () => {
          this.events.publish({
            type: 'agent.low_balance',
            aggregateType: 'agent',
            aggregateId: agent.id,
            payload: {
              spendableMinor: spendableMinor(after.balanceMinor, after.creditLimitMinor),
              contactPhone: after.contactPhone,
              contactEmail: after.contactEmail,
            },
          });
        })
        .catch((e: unknown) =>
          this.log.warn(
            { agentId: agent.id, err: (e as Error).message },
            'low-balance alert not queued',
          ),
        );
    }
    return {
      bookingId,
      pnr,
      totalMinor: debit.totalMinor,
      commissionMinor: debit.commissionMinor,
      balanceMinor: after?.balanceMinor ?? 0,
    };
  }

  /** An agent cancels one of THEIR OWN bookings (full, or specific seats). Refund lands on their account. */
  async agentCancel(bookingId: BookingId, input: { reason?: string; seatNumbers?: string[] }) {
    const agent = await this.me();
    await this.assertOwns(agent.id, bookingId);
    const reason = input.reason ?? 'cancelled by agent';
    return input.seatNumbers?.length
      ? this.bookingService.cancelSeats(bookingId, input.seatNumbers, reason)
      : this.bookingService.cancel(bookingId, reason);
  }

  /* ───────────────────────── helpers ────────────────────────────────────── */

  private async assertOwns(agentId: AgentId, bookingId: BookingId): Promise<void> {
    const owner = await this.agents.agentForBooking(bookingId);
    // Same 404 for "not yours" and "doesn't exist" — never confirm another agent's PNR exists.
    if (owner !== agentId) throw new NotFoundError('Booking', bookingId);
  }

  private decorate(agent: Agent): Agent & { spendableMinor: number; lowBalance: boolean } {
    return {
      ...agent,
      spendableMinor: spendableMinor(agent.balanceMinor, agent.creditLimitMinor),
      lowBalance: isLowBalance(
        agent.balanceMinor,
        agent.creditLimitMinor,
        agent.lowBalanceAlertMinor,
      ),
    };
  }

  /** Tenant-local 'agent' role — tenants provisioned before this feature won't have one yet. */
  private async ensureAgentRole(): Promise<RoleId> {
    const existing = await this.roles.findByCode('agent');
    if (existing) return existing.id;
    return this.roles.createRole({
      tenantId: requireTenantId(),
      code: 'agent',
      name: 'Travel Agent',
      description: 'B2B agent — agent portal only',
      isSystem: true,
      permissions: AGENT_ROLE_PERMISSIONS,
    });
  }

  private suggestCode(name: string): string {
    const letters = name
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 4)
      .toUpperCase()
      .padEnd(3, 'X');
    return `AG-${letters}-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}
