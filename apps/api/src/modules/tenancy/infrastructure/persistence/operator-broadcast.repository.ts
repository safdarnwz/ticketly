import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId } from '@kernel';

export const BROADCAST_AUDIENCES = ['active', 'all', 'suspended'] as const;
export type BroadcastAudience = (typeof BROADCAST_AUDIENCES)[number];

export interface OperatorBroadcast {
  id: string;
  subject: string;
  body: string;
  audience: BroadcastAudience;
  recipients: number;
  sent: number;
  failed: number;
  source: 'manual' | 'maintenance';
  createdAt: Date;
}

/** Platform → operator bulk messages (#108) and who they went to. Platform data, no RLS. */
@Injectable()
export class OperatorBroadcastRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Contact address of every operator in the audience. */
  recipients(
    audience: BroadcastAudience,
  ): Promise<{ tenantId: string; email: string; name: string }[]> {
    return this.db.query(
      `SELECT id AS "tenantId", contact_email AS email, display_name AS name FROM tenants
        WHERE deleted_at IS NULL AND contact_email IS NOT NULL AND contact_email <> ''
          AND ($1 = 'all' OR status::text = $1)
        ORDER BY created_at`,
      [audience],
      { name: 'broadcast.recipients', primary: true },
    );
  }

  async record(
    b: Omit<OperatorBroadcast, 'id' | 'createdAt'>,
    actorId: string | null,
  ): Promise<string> {
    const id = newId();
    await this.db.execute_(
      `INSERT INTO operator_broadcasts (id, subject, body, audience, recipients, sent, failed, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, b.subject, b.body, b.audience, b.recipients, b.sent, b.failed, b.source, actorId],
      { name: 'broadcast.record', primary: true },
    );
    return id;
  }

  list(limit: number): Promise<OperatorBroadcast[]> {
    return this.db.query(
      `SELECT id, subject, body, audience, recipients, sent, failed, source, created_at AS "createdAt"
         FROM operator_broadcasts ORDER BY created_at DESC LIMIT $1`,
      [limit],
      { name: 'broadcast.list' },
    );
  }
}
