import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';

/** The quotas of an operator's current plan. */
@Injectable()
export class PlanQuotaRepository {
  constructor(private readonly db: DatabaseService) {}

  async quotasFor(tenantId: string): Promise<Record<string, unknown>> {
    const row = await this.db.queryOne<{ quotas: Record<string, unknown> | null }>(
      `SELECT p.quotas FROM tenants t LEFT JOIN plans p ON p.id = t.plan_id WHERE t.id = $1`,
      [tenantId],
      { name: 'planQuota.quotasFor', primary: true },
    );
    return row?.quotas ?? {};
  }
}
