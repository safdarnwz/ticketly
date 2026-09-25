import { Injectable } from '@nestjs/common';
import { type LoginWindow } from '../../domain/access-policy';

import { CacheNamespace, CacheService, CacheTtl } from '@cache';
import { DatabaseService, registerConstraintMessages } from '@database';
import {
  newId,
  requireTenantId,
  type Json,
  type RoleId,
  type TenantId,
  type UserId,
  ConflictError,
  NotFoundError,
  getTenantId,
} from '@kernel';

registerConstraintMessages({
  roles_tenant_id_code_key: 'A role with this code already exists',
});

export interface Role {
  id: RoleId;
  tenantId: TenantId | null;
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  conditions: Record<string, Json>;
  permissions: string[];
}

/** The system roles every tenant receives at provisioning. */
export const SYSTEM_ROLES: { code: string; name: string; permissions: string[] }[] = [
  { code: 'owner', name: 'Owner', permissions: ['*'] },
  {
    code: 'admin',
    name: 'Administrator',
    permissions: [
      'tenant:read',
      'tenant:manage',
      'user:read',
      'user:manage',
      'role:manage',
      'route:read',
      'route:manage',
      'stop:manage',
      'layout:manage',
      'vehicle:read',
      'vehicle:manage',
      'crew:manage',
      'service:read',
      'service:manage',
      'trip:manage',
      'inventory:manage',
      'fare:read',
      'fare:manage',
      'booking:read',
      'booking:create',
      'booking:cancel',
      'booking:reschedule',
      'payment:read',
      'payment:refund',
      'settlement:manage',
      'tracking:read',
      'report:read',
      'report:export',
      'agent:read',
      'agent:manage',
    ],
  },
  {
    code: 'manager',
    name: 'Operations Manager',
    permissions: [
      'route:read',
      'vehicle:read',
      'crew:manage',
      'service:read',
      'service:manage',
      'trip:manage',
      'inventory:manage',
      'fare:read',
      'booking:read',
      'booking:cancel',
      'booking:reschedule',
      'tracking:read',
      'report:read',
    ],
  },
  {
    code: 'support',
    name: 'Support Agent',
    permissions: [
      'booking:read',
      'booking:create',
      'booking:cancel',
      'booking:reschedule',
      'payment:read',
      'report:read',
    ],
  },
  {
    code: 'viewer',
    name: 'Viewer',
    permissions: ['booking:read', 'report:read', 'route:read', 'service:read'],
  },
  // B2B travel agent — an EXTERNAL party. agent:portal ONLY: never the
  // generic booking:* permissions, which reach every booking in the tenant.
  { code: 'agent', name: 'Travel Agent', permissions: ['agent:portal'] },
];

/**
 * Role & permission-grant repository.
 *
 * The one query that MUST be fast is "what permissions does this user have?" —
 * it runs on login to bake the permission set into the access token. It is a
 * single joined query, and the result is cached so subsequent token refreshes
 * are cheap.
 */
export interface ResolvedAccess {
  permissions: string[];
  roles: string[];
  active: boolean;
  accessExpiresAt: string | null;
  tokensValidAfter: string | null;
  loginWindow: LoginWindow | null;
}

@Injectable()
export class RoleRepository {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Flattened permission set for a user, unioned across all their roles.
   * Runs on EVERY authenticated request, so it is cached per user (L1 memory
   * + L2 Redis, USER_PERMISSIONS / 120 s) and invalidated on grant, revoke
   * and role-permission changes. `active` is false for a disabled or deleted
   * user — the auth guard then refuses the request even though their access
   * token has not expired yet (before, a deactivated user kept full access
   * until token expiry because the user's status was never checked).
   */
  async resolvePermissions(userId: UserId): Promise<ResolvedAccess> {
    return this.cache.getOrLoad(
      userId,
      { namespace: CacheNamespace.USER_PERMISSIONS, ttlSeconds: CacheTtl.PERMISSIONS },
      async () => {
        const rows = await this.db.query<{
          user_ok: boolean;
          permission: string | null;
          role_code: string | null;
          access_expires_at: string | null;
          tokens_valid_after: string | null;
          login_window: LoginWindow | null;
        }>(
          `SELECT (u.status = 'active' AND u.deleted_at IS NULL) AS user_ok, rp.permission, r.code AS role_code,
                  u.access_expires_at, u.tokens_valid_after, u.login_window
             FROM users u
             -- time-limited grants (206) drop out when they expire (within the cache TTL, or at once on invalidation)
             LEFT JOIN user_roles ur ON ur.user_id = u.id AND (ur.expires_at IS NULL OR ur.expires_at > now())
             LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
             LEFT JOIN role_permissions rp ON rp.role_id = r.id
            WHERE u.id = $1`,
          [userId],
          { name: 'rbac.resolvePermissions', primary: true },
        );
        const active = rows.length > 0 && rows[0].user_ok === true;
        const access = {
          accessExpiresAt: rows[0]?.access_expires_at ?? null,
          tokensValidAfter: rows[0]?.tokens_valid_after ?? null,
          loginWindow: rows[0]?.login_window ?? null,
        };
        if (!active) return { permissions: [], roles: [], active: false, ...access };
        const permissions = new Set<string>();
        const roles = new Set<string>();
        for (const row of rows) {
          if (row.role_code) roles.add(row.role_code);
          if (row.permission) permissions.add(row.permission);
        }
        return { permissions: [...permissions], roles: [...roles], active: true, ...access };
      },
    );
  }

  /** Drop one user's cached permissions (after a grant / revoke / status change). */
  async invalidateUser(userId: UserId): Promise<void> {
    await this.cache.invalidate(userId, CacheNamespace.USER_PERMISSIONS);
  }

  async findByCode(code: string): Promise<Role | null> {
    const row = await this.db.queryOne<RoleRow>(
      `SELECT id, tenant_id, code, name, description, is_system, conditions
         FROM roles WHERE tenant_id IS NOT DISTINCT FROM $1 AND code = $2 AND deleted_at IS NULL`,
      [this.tenantScope(), code],
      { name: 'rbac.findByCode', primary: true },
    );
    if (!row) return null;
    return { ...mapRole(row), permissions: await this.permissionsOf(row.id) };
  }

  /** A platform-level role (tenant_id IS NULL), whatever tenant is in context. */
  async findPlatformRole(code: string): Promise<Role | null> {
    const row = await this.db.queryOne<RoleRow>(
      `SELECT id, tenant_id, code, name, description, is_system, conditions
         FROM roles WHERE tenant_id IS NULL AND code = $1 AND deleted_at IS NULL`,
      [code],
      { name: 'rbac.findPlatformRole', primary: true },
    );
    if (!row) return null;
    return { ...mapRole(row), permissions: await this.permissionsOf(row.id) };
  }

  async list(): Promise<Role[]> {
    const rows = await this.db.query<RoleRow>(
      `SELECT id, tenant_id, code, name, description, is_system, conditions
         FROM roles WHERE tenant_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL ORDER BY is_system DESC, code`,
      [this.tenantScope()],
      { name: 'rbac.list' },
    );
    const roles: Role[] = [];
    for (const row of rows)
      roles.push({ ...mapRole(row), permissions: await this.permissionsOf(row.id) });
    return roles;
  }

  /** Create a role and its permission grants. Called within a unit of work. */
  async createRole(input: {
    tenantId: TenantId | null;
    code: string;
    name: string;
    description?: string;
    isSystem?: boolean;
    permissions: string[];
    conditions?: Record<string, Json>;
  }): Promise<RoleId> {
    const id = newId() as RoleId;
    await this.db.execute_(
      `INSERT INTO roles (id, tenant_id, code, name, description, is_system, conditions)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        input.tenantId,
        input.code,
        input.name,
        input.description ?? '',
        input.isSystem ?? false,
        JSON.stringify(input.conditions ?? {}),
      ],
      { name: 'rbac.createRole', primary: true },
    );
    await this.setPermissions(id, input.permissions);
    return id;
  }

  async setPermissions(roleId: RoleId, permissions: string[]): Promise<void> {
    await this.db.execute_(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId], {
      name: 'rbac.clearPerms',
      primary: true,
    });
    if (permissions.length === 0) return;
    const values: unknown[] = [];
    const tuples = permissions.map((perm, i) => {
      values.push(roleId, perm);
      return `($${i * 2 + 1}, $${i * 2 + 2})`;
    });
    await this.db.execute_(
      `INSERT INTO role_permissions (role_id, permission) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`,
      values,
      { name: 'rbac.setPerms', primary: true },
    );
    // A role's permissions changed → every holder's cached set is stale.
    await this.cache.invalidatePrefix(CacheNamespace.USER_PERMISSIONS);
  }

  async grantToUser(
    userId: UserId,
    roleId: RoleId,
    grantedBy: UserId | null,
    expiresAt: Date | null = null,
  ): Promise<void> {
    await this.db.execute_(
      `INSERT INTO user_roles (user_id, role_id, granted_by, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, role_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, granted_by = EXCLUDED.granted_by`,
      [userId, roleId, grantedBy, expiresAt],
      { name: 'rbac.grant', primary: true },
    );
    await this.invalidateUser(userId);
  }

  /** Copy a role (its permissions) under a new code/name (202). */
  async duplicate(roleId: RoleId, code: string, name: string): Promise<string> {
    const src = await this.db.queryOne<{ id: string; description: string | null }>(
      `SELECT id, description FROM roles WHERE id = $1 AND deleted_at IS NULL AND (tenant_id = $2 OR tenant_id IS NULL)`,
      [roleId, getTenantId() ?? null],
      { name: 'rbac.dupSrc' },
    );
    if (!src) throw new NotFoundError('Role', roleId);
    const id = newId();
    await this.db.execute_(
      `INSERT INTO roles (id, tenant_id, code, name, description, is_system) VALUES ($1,$2,$3,$4,$5,false)`,
      [id, requireTenantId(), code, name, src.description],
      { name: 'rbac.dupInsert', primary: true },
    );
    await this.db.execute_(
      `INSERT INTO role_permissions (role_id, permission) SELECT $1, permission FROM role_permissions WHERE role_id = $2`,
      [id, roleId],
      { name: 'rbac.dupPerms', primary: true },
    );
    return id;
  }

  /** Delete a custom role (203): never a system role, never one still assigned to someone. */
  async softDelete(roleId: RoleId): Promise<void> {
    const r = await this.db.queryOne<{ is_system: boolean; holders: string }>(
      `SELECT r.is_system, (SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id AND (ur.expires_at IS NULL OR ur.expires_at > now())) AS holders
         FROM roles r WHERE r.id = $1 AND r.tenant_id = $2 AND r.deleted_at IS NULL`,
      [roleId, requireTenantId()],
      { name: 'rbac.delCheck', primary: true },
    );
    if (!r) throw new NotFoundError('Role', roleId);
    if (r.is_system) throw new ConflictError('Built-in roles cannot be deleted');
    if (Number(r.holders) > 0)
      throw new ConflictError(
        `This role is still assigned to ${r.holders} user(s) — remove it from them first`,
      );
    await this.db.execute_(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [roleId], {
      name: 'rbac.delete',
      primary: true,
    });
  }

  async revokeFromUser(userId: UserId, roleId: RoleId): Promise<void> {
    await this.db.execute_(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId],
      { name: 'rbac.revoke', primary: true },
    );
    await this.invalidateUser(userId);
  }

  private async permissionsOf(roleId: RoleId): Promise<string[]> {
    const rows = await this.db.query<{ permission: string }>(
      `SELECT permission FROM role_permissions WHERE role_id = $1`,
      [roleId],
      { name: 'rbac.permissionsOf', primary: true },
    );
    return rows.map((r) => r.permission);
  }

  private tenantScope(): TenantId | null {
    try {
      return requireTenantId();
    } catch {
      return null;
    }
  }
}

interface RoleRow {
  id: RoleId;
  tenant_id: TenantId | null;
  code: string;
  name: string;
  description: string;
  is_system: boolean;
  conditions: Record<string, Json>;
}

function mapRole(row: RoleRow): Omit<Role, 'permissions'> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    conditions: row.conditions ?? {},
  };
}
