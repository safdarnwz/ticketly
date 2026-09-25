import { Injectable } from '@nestjs/common';

import { UnitOfWork } from '@database';
import {
  ConflictError,
  createContext,
  newId,
  runWithContext,
  type TenantId,
  type UserId,
} from '@kernel';
import { EventBus } from '@messaging';
import { Logger } from '@observability';
import { PasswordHasher } from '@security';

import { AuditService, User, RoleRepository, SYSTEM_ROLES, UserRepository } from '../../../iam';
import { Tenant } from '../../domain/tenant.entity';
import { PlanRepository } from '../../infrastructure/persistence/plan.repository';
import { TenantContextService } from './tenant-context.service';
import { TenantRepository } from '../../infrastructure/persistence/tenant.repository';
import { defaultLogoSvg, FileService } from '../../../files';
import { DEFAULT_OPERATOR_TEMPLATES, NotificationService } from '../../../notification';
import { PlatformPoliciesService } from '../../../platform-settings';

export interface ProvisionOperatorInput {
  slug: string;
  legalName: string;
  displayName: string;
  contactEmail: string;
  contactPhone?: string;
  planCode?: string;
  /** Known when the operator comes from an onboarding application. */
  business?: {
    bank: {
      holder: string | null;
      accountNumber: string | null;
      ifsc: string | null;
      name: string | null;
    };
    gstin: string | null;
    registeredAddress: string | null;
  };
  /** A new password (checked against the policy), or the applicant's existing hash. */
  owner: { fullName: string; email: string; phone?: string } & (
    { password: string } | { passwordHash: string }
  );
}

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
    private readonly policies: PlatformPoliciesService,
    private readonly notifications: NotificationService,
    private readonly files: FileService,
  ) {
    this.log = logger.forContext('TenantProvisioning');
  }

  /**
   * Create an operator — the one path for both the platform admin
   * (POST /admin/tenants) and an approved onboarding application. In one
   * transaction: the tenant (with bank / GST / address when known), its
   * default staff roles, the owner (a tenant copy of the platform
   * `operator_admin` role — every operator permission, never the platform's
   * `*`), the default notification templates, activation and the audit row.
   * Then, best-effort, a default logo.
   */
  async provision(input: ProvisionOperatorInput): Promise<{ tenantId: TenantId; ownerId: UserId }> {
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

    let ownerPasswordHash: string;
    if ('passwordHash' in input.owner) ownerPasswordHash = input.owner.passwordHash;
    else {
      await this.policies.assertPasswordAcceptable(input.owner.password);
      ownerPasswordHash = await this.hasher.hash(input.owner.password);
    }

    const ownerId = await this.uow.run<UserId>(
      { name: 'tenant.provision', tenantId, bypassRls: true },
      async () => {
        await this.tenants.insert(tenant);
        if (input.business) await this.tenants.setBusinessDetails(tenantId, input.business);

        for (const role of SYSTEM_ROLES)
          await this.roles.createRole({
            tenantId,
            code: role.code,
            name: role.name,
            isSystem: true,
            permissions: role.permissions,
          });
        const ownerRoleId = await this.roles.cloneFromPlatform(tenantId, 'operator_admin');

        const owner = User.create(newId() as UserId, {
          tenantId,
          kind: 'staff',
          fullName: input.owner.fullName,
          email: input.owner.email,
          phone: input.owner.phone ?? null,
          passwordHash: ownerPasswordHash,
          status: 'active',
        });
        // insert() encrypts PII and scopes by the ambient tenant.
        await runWithContext(createContext({ tenantId, actorType: 'system' }), () =>
          this.users.insert(owner),
        );
        await this.roles.grantToUser(owner.id, ownerRoleId, null);

        await this.notifications.seedDefaults(tenantId, [...DEFAULT_OPERATOR_TEMPLATES]);

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
    await this.provisionDefaultLogo(tenantId, input.displayName);
    this.log.info({ tenantId, slug: input.slug }, 'tenant provisioned');
    return { tenantId, ownerId };
  }

  /**
   * Every operator starts with a branded default logo ({slug}/branding/logo.svg).
   * Outside the transaction on purpose: object storage is not transactional,
   * and a storage hiccup must never block creating the operator.
   */
  private async provisionDefaultLogo(tenantId: TenantId, displayName: string): Promise<void> {
    try {
      await runWithContext(createContext({ tenantId, actorType: 'system' }), async () => {
        const logo = await this.files.store({
          purpose: 'tenant_logo',
          folder: 'branding',
          fixedName: 'logo',
          fileName: 'logo.svg',
          bytes: Buffer.from(defaultLogoSvg(displayName), 'utf8'),
          visibility: 'public',
          allowSvg: true,
          allowedMimes: ['image/svg+xml'],
        });
        await this.tenants.setLogoFile({
          fileId: logo.id,
          objectKey: logo.objectKey,
          url: logo.url,
        });
      });
    } catch (e) {
      this.log.warn(
        { tenantId, err: (e as Error).message },
        'default logo not created — operator can upload one later',
      );
    }
  }

  async suspend(tenantId: TenantId, reason: string): Promise<void> {
    await this.uow.run({ name: 'tenant.suspend', tenantId, bypassRls: true }, async () => {
      const tenant = await this.tenants.findById(tenantId);
      if (!tenant) throw new ConflictError('Operator not found');
      tenant.suspend(reason);
      await this.tenants.update(tenant, tenant.version);
      this.events.publishAll(tenant.pullEvents());
      await this.audit.recordInTx({
        action: 'tenant.suspended',
        resourceType: 'tenant',
        resourceId: tenantId,
        tenantId,
        changes: { reason },
      });
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
      await this.audit.recordInTx({
        action: 'tenant.activated',
        resourceType: 'tenant',
        resourceId: tenantId,
        tenantId,
      });
    });
    await this.tenantContext.invalidate(tenantId);
  }
}
