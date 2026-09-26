import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  DomainError,
  ErrorCode,
  getUserId,
  NotFoundError,
  requireTenantId,
  type AgentId,
} from '@kernel';

import {
  decideComplaint,
  type ComplaintCategory,
  type ComplaintOutcome,
} from '../../domain/agent-complaint';
import { AgentComplaintRepository } from '../../infrastructure/persistence/agent-complaint.repository';
import { AgentRepository } from '../../infrastructure/persistence/agent.repository';

/** Formal complaints the operator records against its travel agents, and their outcome. */
@Injectable()
export class AgentComplaintService {
  constructor(
    private readonly complaints: AgentComplaintRepository,
    private readonly agents: AgentRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async list(agentId: AgentId) {
    await this.agent(agentId);
    return this.complaints.list(agentId);
  }

  /** About one of the agent's own bookings when a PNR is given. */
  async raise(
    agentId: AgentId,
    input: { category: ComplaintCategory; description: string; pnr?: string },
  ): Promise<{ id: string }> {
    await this.agent(agentId);
    let bookingId: string | null = null;
    if (input.pnr) {
      const booking = await this.complaints.bookingByPnr(input.pnr);
      if (!booking) throw new NotFoundError('Booking', input.pnr);
      if (booking.agentId !== agentId)
        throw new DomainError(ErrorCode.COMMON_VALIDATION, 'This agent did not sell that booking');
      bookingId = booking.id;
    }
    const id = await this.complaints.create({
      agentId,
      category: input.category,
      description: input.description,
      bookingId,
      raisedBy: getUserId() ?? null,
    });
    return { id };
  }

  async decide(
    agentId: AgentId,
    complaintId: string,
    outcome: ComplaintOutcome,
    resolution: string,
  ): Promise<{ status: ComplaintOutcome }> {
    return this.uow.run(
      { name: 'agentComplaint.decide', tenantId: requireTenantId() },
      async () => {
        const c = await this.complaints.lock(agentId, complaintId);
        if (!c) throw new NotFoundError('Complaint', complaintId);
        const step = decideComplaint(c.status, outcome);
        if (step === 'conflict')
          throw new DomainError(
            ErrorCode.COMMON_VALIDATION,
            `This complaint was already ${c.status} — a decision is final`,
          );
        if (step === 'apply')
          await this.complaints.decide(complaintId, outcome, resolution, getUserId() ?? null);
        return { status: outcome };
      },
    );
  }

  private async agent(agentId: AgentId) {
    const agent = await this.agents.getById(agentId);
    if (!agent) throw new NotFoundError('Agent', agentId);
    return agent;
  }
}
