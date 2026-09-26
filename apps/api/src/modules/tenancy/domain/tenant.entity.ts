import {
  AggregateRoot,
  DomainError,
  ErrorCode,
  createEvent,
  type Json,
  type TenantId,
  type Uuid,
} from '@kernel';

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'closed';

export interface TenantProps {
  slug: string;
  legalName: string;
  displayName: string;
  status: TenantStatus;
  planId: Uuid | null;
  primaryDomain: string | null;
  contactEmail: string;
  contactPhone: string | null;
  timezone: string;
  currency: string;
  locale: string;
  settings: Record<string, Json>;
  featureOverrides: Record<string, Json>;
  suspendedReason: string | null;
  createdAt: Date;
}

/**
 * Tenant (bus operator) aggregate root.
 *
 * The aggregate owns the operator's LIFECYCLE invariants — the rules about what
 * state transitions are legal. Everything a repository needs to persist is in
 * `props`; the behaviour here is what a service calls to change state safely.
 *
 * Why an aggregate and not an anaemic row: "you cannot activate a closed
 * tenant" and "suspending requires a reason" are business rules that must hold
 * no matter which endpoint or job touches the tenant. Encoding them here means
 * they cannot be bypassed by a stray UPDATE in some new controller.
 */
export class Tenant extends AggregateRoot<TenantId> {
  private constructor(
    id: TenantId,
    private props: TenantProps,
    version: number,
  ) {
    super(id);
    this._version = version;
  }

  static rehydrate(id: TenantId, props: TenantProps, version: number): Tenant {
    return new Tenant(id, props, version);
  }

  static provision(
    id: TenantId,
    input: {
      slug: string;
      legalName: string;
      displayName: string;
      contactEmail: string;
      contactPhone?: string | null;
      planId?: Uuid | null;
      timezone?: string;
      currency?: string;
      locale?: string;
    },
  ): Tenant {
    const tenant = new Tenant(
      id,
      {
        slug: normaliseSlug(input.slug),
        legalName: input.legalName.trim(),
        displayName: input.displayName.trim(),
        status: 'provisioning',
        planId: input.planId ?? null,
        primaryDomain: null,
        contactEmail: input.contactEmail.trim().toLowerCase(),
        contactPhone: input.contactPhone ?? null,
        timezone: input.timezone ?? 'Asia/Kolkata',
        currency: input.currency ?? 'INR',
        locale: input.locale ?? 'en-IN',
        settings: {},
        featureOverrides: {},
        suspendedReason: null,
        createdAt: new Date(),
      },
      0,
    );
    tenant.record(
      createEvent({
        type: 'tenant.provisioned',
        aggregateType: 'tenant',
        aggregateId: id,
        tenantId: id,
        payload: { slug: tenant.props.slug, displayName: tenant.props.displayName },
      }),
    );
    return tenant;
  }

  /** Provisioning completed (seed roles/owner created) → operator can trade. */
  activate(): void {
    if (this.props.status === 'active') return;
    if (this.props.status === 'closed') {
      throw new DomainError(
        ErrorCode.BOOKING_INVALID_STATE,
        'A closed operator cannot be re-activated',
      );
    }
    this.props.status = 'active';
    this.props.suspendedReason = null;
    this.record(
      createEvent({
        type: 'tenant.activated',
        aggregateType: 'tenant',
        aggregateId: this.id,
        tenantId: this.id,
        payload: {},
      }),
    );
  }

  suspend(reason: string): void {
    if (!reason.trim()) {
      throw new DomainError(ErrorCode.COMMON_VALIDATION, 'A suspension reason is required');
    }
    if (this.props.status === 'closed') {
      throw new DomainError(ErrorCode.BOOKING_INVALID_STATE, 'Operator is already closed');
    }
    this.props.status = 'suspended';
    this.props.suspendedReason = reason.trim();
    this.record(
      createEvent({
        type: 'tenant.suspended',
        aggregateType: 'tenant',
        aggregateId: this.id,
        tenantId: this.id,
        payload: { reason: reason.trim() },
      }),
    );
  }

  changePlan(planId: Uuid): void {
    this.props.planId = planId;
    this.record(
      createEvent({
        type: 'tenant.plan_changed',
        aggregateType: 'tenant',
        aggregateId: this.id,
        tenantId: this.id,
        payload: { planId },
      }),
    );
  }

  updateProfile(
    patch: Partial<
      Pick<
        TenantProps,
        'displayName' | 'contactEmail' | 'contactPhone' | 'timezone' | 'currency' | 'locale'
      >
    >,
  ): void {
    Object.assign(this.props, patch);
  }

  setPrimaryDomain(domain: string | null): void {
    this.props.primaryDomain = domain ? domain.trim().toLowerCase() : null;
  }

  get status(): TenantStatus {
    return this.props.status;
  }
  get slug(): string {
    return this.props.slug;
  }
  get isActive(): boolean {
    return this.props.status === 'active';
  }
  snapshot(): Readonly<TenantProps> {
    return this.props;
  }
}

function normaliseSlug(slug: string): string {
  const normalised = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (normalised.length < 2 || normalised.length > 63) {
    throw new DomainError(ErrorCode.COMMON_VALIDATION, 'Slug must be 2-63 URL-safe characters');
  }
  return normalised;
}
