import { Injectable } from '@nestjs/common';

import { currentTransaction, DatabaseService } from '@database';
import { newId, requireTenantId, type AgentId } from '@kernel';

import type {
  ComplaintCategory,
  ComplaintOutcome,
  ComplaintStatus,
} from '../../domain/agent-complaint';

export interface AgentComplaint {
  id: string;
  agentId: string;
  category: ComplaintCategory;
  description: string;
  bookingId: string | null;
  pnr: string | null;
  status: ComplaintStatus;
  resolution: string | null;
  raisedByName: string | null;
  resolvedByName: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

@Injectable()
export class AgentComplaintRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Newest first. */
  list(agentId: AgentId): Promise<AgentComplaint[]> {
    return this.db.query<AgentComplaint>(
      `SELECT c.id, c.agent_id AS "agentId", c.category, c.description, c.booking_id AS "bookingId",
              b.pnr, c.status, c.resolution, ru.full_name AS "raisedByName",
              du.full_name AS "resolvedByName", c.created_at AS "createdAt", c.resolved_at AS "resolvedAt"
         FROM agent_complaints c
         LEFT JOIN bookings b ON b.id = c.booking_id
         LEFT JOIN users ru ON ru.id = c.raised_by
         LEFT JOIN users du ON du.id = c.resolved_by
        WHERE c.tenant_id = $1 AND c.agent_id = $2
        ORDER BY c.created_at DESC`,
      [requireTenantId(), agentId],
      { name: 'agentComplaint.list' },
    );
  }

  async create(input: {
    agentId: AgentId;
    category: ComplaintCategory;
    description: string;
    bookingId: string | null;
    raisedBy: string | null;
  }): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO agent_complaints (id, tenant_id, agent_id, category, description, booking_id, raised_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        requireTenantId(),
        input.agentId,
        input.category,
        input.description,
        input.bookingId,
        input.raisedBy,
      ],
      { name: 'agentComplaint.create', primary: true },
    );
    return id;
  }

  /** Locked inside the caller's transaction, so two people cannot decide it at once. */
  async lock(agentId: AgentId, id: string): Promise<{ status: ComplaintStatus } | null> {
    const scope = currentTransaction();
    if (!scope) throw new Error('lock must run inside a transaction');
    const r = await scope.client.query<{ status: ComplaintStatus }>(
      `SELECT status FROM agent_complaints WHERE tenant_id = $1 AND agent_id = $2 AND id = $3 FOR UPDATE`,
      [requireTenantId(), agentId, id],
    );
    return r.rows[0] ?? null;
  }

  async decide(id: string, outcome: ComplaintOutcome, resolution: string, by: string | null) {
    const scope = currentTransaction();
    if (!scope) throw new Error('decide must run inside a transaction');
    await scope.client.query(
      `UPDATE agent_complaints SET status = $3, resolution = $4, resolved_by = $5, resolved_at = now()
        WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, outcome, resolution, by],
    );
  }

  /** A booking of this operator by PNR, and the agent who sold it. */
  bookingByPnr(pnr: string): Promise<{ id: string; agentId: string | null } | null> {
    return this.db.queryOne(
      `SELECT id, agent_id AS "agentId" FROM bookings WHERE tenant_id = $1 AND pnr = upper($2)`,
      [requireTenantId(), pnr],
      { name: 'agentComplaint.bookingByPnr' },
    );
  }
}
