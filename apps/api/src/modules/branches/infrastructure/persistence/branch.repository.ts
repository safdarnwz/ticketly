import { Injectable } from '@nestjs/common';

import { DatabaseService, registerConstraintMessages } from '@database';
import { newId, requireTenantId, type BranchId } from '@kernel';

import type { WorkingHours } from '../../domain/working-hours';

export interface Branch {
  id: BranchId;
  name: string;
  address: string | null;
  phone: string | null;
  managerUserId: string | null;
  status: 'active' | 'inactive';
  workingHours: WorkingHours;
  createdAt: Date;
}

registerConstraintMessages({
  branches_tenant_id_name_key: 'A branch with this name already exists',
});

@Injectable()
export class BranchRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    name: string;
    address?: string;
    phone?: string;
    managerUserId?: string;
    workingHours?: WorkingHours;
  }): Promise<BranchId> {
    const id = newId() as BranchId;
    await this.db.execute_(
      `INSERT INTO branches (id, tenant_id, name, address, phone, manager_user_id, working_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        requireTenantId(),
        input.name,
        input.address ?? null,
        input.phone ?? null,
        input.managerUserId ?? null,
        JSON.stringify(input.workingHours ?? {}),
      ],
      { name: 'branch.create', primary: true },
    );
    return id;
  }

  /** Another branch of this operator already using the name, ignoring case and spaces. */
  async nameTaken(name: string, exceptId?: BranchId): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM branches
        WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) AND ($3::uuid IS NULL OR id <> $3)`,
      [requireTenantId(), name, exceptId ?? null],
      { name: 'branch.nameTaken', primary: true },
    );
    return !!row;
  }

  /** A manager must be staff of this operator (a foreign key alone accepts anyone's user). */
  async isStaff(userId: string): Promise<boolean> {
    const row = await this.db.queryOne(
      `SELECT 1 FROM users WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [requireTenantId(), userId],
      { name: 'branch.isStaff', primary: true },
    );
    return !!row;
  }

  /** Branches counting towards the plan quota: the active ones. */
  async countActive(): Promise<number> {
    const row = await this.db.queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM branches WHERE tenant_id = $1 AND status = 'active'`,
      [requireTenantId()],
      { name: 'branch.countActive', primary: true },
    );
    return Number(row?.n ?? 0);
  }

  async update(
    id: BranchId,
    input: {
      name?: string;
      address?: string;
      phone?: string;
      managerUserId?: string;
      workingHours?: WorkingHours;
    },
  ): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE branches SET
         name = coalesce($3, name), address = coalesce($4, address),
         phone = coalesce($5, phone), manager_user_id = coalesce($6, manager_user_id),
         working_hours = coalesce($7::jsonb, working_hours)
       WHERE tenant_id = $1 AND id = $2`,
      [
        requireTenantId(),
        id,
        input.name ?? null,
        input.address ?? null,
        input.phone ?? null,
        input.managerUserId ?? null,
        input.workingHours ? JSON.stringify(input.workingHours) : null,
      ],
      { name: 'branch.update', primary: true },
    );
    return n > 0;
  }

  async setStatus(id: BranchId, status: 'active' | 'inactive'): Promise<boolean> {
    const n = await this.db.execute_(
      `UPDATE branches SET status = $3 WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id, status],
      { name: 'branch.setStatus', primary: true },
    );
    return n > 0;
  }

  async find(id: BranchId): Promise<Branch | null> {
    const row = await this.db.queryOne<BranchRow>(
      `SELECT id, name, address, phone, manager_user_id, status, working_hours, created_at
         FROM branches WHERE tenant_id = $1 AND id = $2`,
      [requireTenantId(), id],
      { name: 'branch.find', primary: true },
    );
    return row ? map(row) : null;
  }

  async list(): Promise<Branch[]> {
    const rows = await this.db.query<BranchRow>(
      `SELECT id, name, address, phone, manager_user_id, status, working_hours, created_at
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
  id: BranchId;
  name: string;
  address: string | null;
  phone: string | null;
  manager_user_id: string | null;
  status: Branch['status'];
  working_hours: WorkingHours;
  created_at: Date;
}
function map(r: BranchRow): Branch {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    phone: r.phone,
    managerUserId: r.manager_user_id,
    status: r.status,
    workingHours: r.working_hours,
    createdAt: r.created_at,
  };
}
