import { Injectable } from '@nestjs/common';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService } from '@database';
import type { Json, Uuid } from '@kernel';

export interface Plan {
  id: Uuid;
  code: string;
  name: string;
  features: Record<string, Json>;
  quotas: Record<string, number>;
  monthlyPrice: number;
  currency: string;
  isActive: boolean;
}

/**
 * Plan catalogue repository. Plans are platform-level and change rarely, so
 * every read is cache-backed with a long TTL and explicit invalidation on the
 * (rare) admin edit.
 */
@Injectable()
export class PlanRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  async findById(id: Uuid): Promise<Plan | null> {
    return this.cache.getOrLoad(
      id,
      { namespace: CacheNamespace.TENANT, ttlSeconds: CacheTtl.MASTER_DATA },
      async () => {
        const row = await this.db.queryOne<PlanRow>(
          `SELECT id, code, name, features, quotas, monthly_price, currency, is_active
             FROM plans WHERE id = $1`,
          [id],
          { name: 'plan.findById', primary: true },
        );
        return row ? mapPlan(row) : null;
      },
    );
  }

  async findByCode(code: string): Promise<Plan | null> {
    const row = await this.db.queryOne<PlanRow>(
      `SELECT id, code, name, features, quotas, monthly_price, currency, is_active
         FROM plans WHERE code = $1`,
      [code],
      { name: 'plan.findByCode', primary: true },
    );
    return row ? mapPlan(row) : null;
  }

  async listActive(): Promise<Plan[]> {
    const rows = await this.db.query<PlanRow>(
      `SELECT id, code, name, features, quotas, monthly_price, currency, is_active
         FROM plans WHERE is_active = true ORDER BY sort_order, monthly_price`,
      [],
      { name: 'plan.listActive' },
    );
    return rows.map(mapPlan);
  }

  /** Every plan, active or not — for the platform-admin catalogue editor. */
  async listAll(): Promise<Plan[]> {
    const rows = await this.db.query<PlanRow>(
      `SELECT id, code, name, features, quotas, monthly_price, currency, is_active
         FROM plans ORDER BY sort_order, monthly_price`,
      [],
      { name: 'plan.listAll' },
    );
    return rows.map(mapPlan);
  }

  async create(input: { code: string; name: string; monthlyPrice: number; currency: string; features: Record<string, boolean>; quotas: Record<string, number | null>; sortOrder: number }): Promise<string> {
    const row = await this.db.queryOne<{ id: string }>(
      `INSERT INTO plans (id, code, name, monthly_price, currency, sort_order, features, quotas)
       VALUES (uuid_generate_v7(), $1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, monthly_price = EXCLUDED.monthly_price,
         features = EXCLUDED.features, quotas = EXCLUDED.quotas
       RETURNING id`,
      [input.code, input.name, input.monthlyPrice, input.currency, input.sortOrder, JSON.stringify(input.features), JSON.stringify(input.quotas)],
      { name: 'plan.create', primary: true },
    );
    await this.cache.invalidatePrefix(CacheNamespace.TENANT);
    return row?.id ?? '';
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.db.execute_(`UPDATE plans SET is_active = $2 WHERE id = $1`, [id, isActive], { name: 'plan.setActive', primary: true });
    await this.cache.invalidatePrefix(CacheNamespace.TENANT);
  }
}

interface PlanRow {
  id: Uuid;
  code: string;
  name: string;
  features: Record<string, Json>;
  quotas: Record<string, number>;
  monthly_price: number;
  currency: string;
  is_active: boolean;
}

function mapPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    features: row.features ?? {},
    quotas: row.quotas ?? {},
    monthlyPrice: row.monthly_price,
    currency: row.currency,
    isActive: row.is_active,
  };
}
