import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import { newId, ConflictError, type TenantId, type UserId } from '@kernel';
import { EventBus } from '@messaging';
import { Logger } from '@observability';
import { PasswordHasher } from '@security';

import { AuditService } from '../../../iam/application/services/audit.service';
import { User } from '../../../iam/domain/user.entity';
import { RoleRepository, SYSTEM_ROLES } from '../../../iam/infrastructure/persistence/role.repository';
import { UserRepository } from '../../../iam/infrastructure/persistence/user.repository';
import { Tenant } from '../../domain/tenant.entity';
import { PlanRepository } from '../../infrastructure/persistence/plan.repository';
import { TenantContextService } from './tenant-context.service';
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository';

/**
 * Tenant provisioning — the transactional workflow that stands up a new
 * operator so it can trade.
 *
 * It is ONE unit of work, so the operator, its system roles, and its owner user
 * are all created atomically. A partial provision (tenant with no owner, or
 * roles but no tenant) would be an operational nightmare; the transaction makes
 * that impossible — it either fully succeeds or leaves nothing behind.
 *
 * This runs with `bypassRls` because it is bootstrapping a tenant that does not
 * yet exist to bind to; it is only reachable from the platform-admin surface,
 * and every step is audited.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly log: Logger;

  constructor(
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly plans: PlanRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly tenantContext: TenantContextService,
    private readonly events: EventBus,
    logger: Logger,
  ) {
    this.log = logger.forContext('TenantProvisioning');
  }

  async provision(input: {
    slug: string;
    legalName: string;
    displayName: string;
    contactEmail: string;
    contactPhone?: string;
    planCode?: string;
    owner: { fullName: string; email: string; password: string };
  }): Promise<{ tenantId: TenantId; ownerId: UserId }> {
    const plan = input.planCode ? await this.plans.findByCode(input.planCode) : null;
    const tenantId = newId() as TenantId;

    const tenant = Tenant.provision(tenantId, {
      slug: input.slug,
      legalName: input.legalName,
      displayName: input.displayName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      planId: plan?.id ?? null,
    });

    const ownerPasswordHash = await this.hasher.hash(input.owner.password);

    const ownerId = await this.uow.run<UserId>(
      { name: 'tenant.provision', tenantId, bypassRls: true },
      async () => {
        await this.tenants.insert(tenant);

        // Seed the five system roles for this tenant.
        const roleIds = new Map<string, import('@kernel').RoleId>();
        for (const role of SYSTEM_ROLES) {
          const id = await this.roles.createRole({
            tenantId,
            code: role.code,
            name: role.name,
            isSystem: true,
            permissions: role.permissions,
          });
          roleIds.set(role.code, id);
        }

        // Create the owner user and grant the 'owner' role.
        const owner = User.create(newId() as UserId, {
          tenantId,
          kind: 'staff',
          fullName: input.owner.fullName,
          email: input.owner.email,
          passwordHash: ownerPasswordHash,
        } as never);
        await this.users.insert(owner);
        await this.roles.grantToUser(owner.id, roleIds.get('owner')!, null);

        // Activate now that the tenant is fully stood up.
        tenant.activate();
        await this.tenants.update(tenant, tenant.version);

        this.events.publishAll(tenant.pullEvents());
        await this.audit.recordInTx({
          action: 'tenant.provisioned',
          resourceType: 'tenant',
          resourceId: tenantId,
          tenantId,
          actorType: 'system',
          changes: { slug: input.slug, plan: input.planCode ?? null },
        });

        return owner.id;
      },
    );

    await this.tenantContext.invalidate(tenantId);
    this.log.info({ tenantId, slug: input.slug }, 'tenant provisioned');
    return { tenantId, ownerId };
  }

  async suspend(tenantId: TenantId, reason: string): Promise<void> {
    await this.uow.run({ name: 'tenant.suspend', tenantId, bypassRls: true }, async () => {
      const tenant = await this.tenants.findById(tenantId);
      if (!tenant) throw new ConflictError('Operator not found');
      tenant.suspend(reason);
      await this.tenants.update(tenant, tenant.version);
      this.events.publishAll(tenant.pullEvents());
      await this.audit.recordInTx({ action: 'tenant.suspended', resourceType: 'tenant', resourceId: tenantId, tenantId, changes: { reason } });
    });
    await this.tenantContext.invalidate(tenantId);
  }

  async activate(tenantId: TenantId): Promise<void> {
    await this.uow.run({ name: 'tenant.activate', tenantId, bypassRls: true }, async () => {
      const tenant = await this.tenants.findById(tenantId);
      if (!tenant) throw new ConflictError('Operator not found');
      tenant.activate();
      await this.tenants.update(tenant, tenant.version);
      this.events.publishAll(tenant.pullEvents());
      await this.audit.recordInTx({ action: 'tenant.activated', resourceType: 'tenant', resourceId: tenantId, tenantId });
    });
    await this.tenantContext.invalidate(tenantId);
  }
}
