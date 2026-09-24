import { Injectable } from '@nestjs/common';

import { DatabaseService } from '@database';
import { newId, requireTenantId, type BranchId } from '@kernel';

export interface Branch {
  id: BranchId;
  name: string;
  address: string | null;
  phone: string | null;
  managerUserId: string | null;
  status: 'active' | 'inactive';
  createdAt: Date;
}

@Injectable()
export class BranchRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: { name: string; address?: string; phone?: string; managerUserId?: string }): Promise<BranchId> {
    const id = newId() as BranchId;
    await this.db.execute_(
      `INSERT INTO branches (id, tenant_id, name, address, phone, manager_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, requireTenantId(), input.name, input.address ?? null, input.phone ?? null, input.managerUserId ?? null],
      { name: 'branch.create', primary: true },
    );
    return id;
  }

  async update(id: BranchId, input: { name?: string; address?: string; phone?: string; managerUserId?: string }): Promise<void> {
    await this.db.execute_(
      `UPDATE branches SET
         name = coalesce($3, name), address = coalesce($4, address),
         phone = coalesce($5, phone), manager_user_id = coalesce($6, manager_user_id)
       WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, input.name ?? null, input.address ?? null, input.phone ?? null, input.managerUserId ?? null],
      { name: 'branch.update', primary: true },
    );
  }

  async setStatus(id: BranchId, status: 'active' | 'inactive'): Promise<void> {
    await this.db.execute_(
      `UPDATE branches SET status = $3 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, status],
      { name: 'branch.setStatus', primary: true },
    );
  }

  async list(): Promise<Branch[]> {
    const rows = await this.db.query<BranchRow>(
      `SELECT id, name, address, phone, manager_user_id, status, created_at
         FROM branches WHERE tenant_id = $1 ORDER BY name`,
      [requireTenantId()],
      { name: 'branch.list' },
    );
    return rows.map(map);
  }

  /** Staff headcount per branch — shown alongside the list so deactivating a branch with people still on it is a deliberate, informed choice. */
  async staffCounts(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ branch_id: string; n: string }>(
      `SELECT branch_id, count(*) AS n FROM users WHERE tenant_id = $1 AND branch_id IS NOT NULL AND deleted_at IS NULL GROUP BY branch_id`,
      [requireTenantId()],
      { name: 'branch.staffCounts' },
    );
    return Object.fromEntries(rows.map((r) => [r.branch_id, Number(r.n)]));
  }
}

interface BranchRow {
  id: BranchId; name: string; address: string | null; phone: string | null;
  manager_user_id: string | null; status: Branch['status']; created_at: Date;
}
function map(r: BranchRow): Branch {
  return { id: r.id, name: r.name, address: r.address, phone: r.phone, managerUserId: r.manager_user_id, status: r.status, createdAt: r.created_at };
}
