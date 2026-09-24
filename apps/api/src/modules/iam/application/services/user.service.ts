import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { ConflictError, NotFoundError, newId, requireTenantId, type UserId } from '@kernel';
import { PasswordHasher } from '@security';

import { AuditService } from './audit.service';
import { User } from '../../domain/user.entity';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';
import { UserRepository } from '../../infrastructure/persistence/user.repository';
import { PlatformPoliciesService } from '../../../platform-settings/platform-policies.service';

/**
 * Operator user management (invite / update / role assignment).
 *
 * Every mutation is a unit of work that also writes an audit entry in the same
 * transaction — so "who was invited / disabled / re-roled, and by whom" can
 * never diverge from what actually happened.
 */
@Injectable()
export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly policies: PlatformPoliciesService,
  ) {}

  async invite(input: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    roles: string[];
  }): Promise<UserId> {
    const tenantId = requireTenantId();
    const existing = await this.users.findByEmail(input.email);
    if (existing) throw new ConflictError('A user with this email already exists');

    await this.policies.assertPasswordAcceptable(input.password);
    const passwordHash = await this.hasher.hash(input.password);
    const user = User.create(
      newId() as UserId,
      {
        tenantId,
        kind: 'staff',
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        status: 'active',
      } as never,
    );

    await this.uow.run({ name: 'user.invite', tenantId }, async () => {
      await this.users.insert(user);
      for (const code of input.roles) {
        const role = await this.roles.findByCode(code);
        if (!role) throw new NotFoundError('Role', code);
        await this.roles.grantToUser(user.id, role.id, null);
      }
      await this.audit.recordInTx({
        action: 'user.invited',
        resourceType: 'user',
        resourceId: user.id,
        changes: { roles: input.roles },
      });
    });
    return user.id;
  }

  async update(
    userId: UserId,
    patch: { fullName?: string; phone?: string; status?: 'active' | 'disabled' },
  ): Promise<void> {
    await this.uow.run({ name: 'user.update', tenantId: requireTenantId() }, async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('User', userId);
      if (patch.fullName || patch.phone)
        user.updateProfile({
          fullName: patch.fullName ?? user.snapshot().fullName,
          phone: patch.phone ?? user.snapshot().phone,
        });
      if (patch.status === 'disabled') {
        user.disable();
        await this.sessions.revokeAllForUser(userId, 'user-disabled');
      }
      if (patch.status === 'active') user.enable();
      await this.users.update(user, user.version);
      await this.audit.recordInTx({
        action: 'user.updated',
        resourceType: 'user',
        resourceId: userId,
        changes: patch,
      });
    });
  }

  async assignRoles(userId: UserId, roleCodes: string[]): Promise<void> {
    await this.uow.run({ name: 'user.assignRoles', tenantId: requireTenantId() }, async () => {
      const user = await this.users.findById(userId);
      if (!user) throw new NotFoundError('User', userId);
      // Resolve every code first so a bad one fails before we change anything.
      const roleIds = [];
      for (const code of roleCodes) {
        const role = await this.roles.findByCode(code);
        if (!role) throw new NotFoundError('Role', code);
        roleIds.push(role.id);
      }
      for (const roleId of roleIds) await this.roles.grantToUser(userId, roleId, null);
      // Role change → existing access tokens carry stale permissions. Force a
      // re-login by revoking sessions (the customer app refreshes silently).
      await this.sessions.revokeAllForUser(userId, 'roles-changed');
      await this.audit.recordInTx({
        action: 'user.roles_assigned',
        resourceType: 'user',
        resourceId: userId,
        changes: { roles: roleCodes },
      });
    });
  }
}
