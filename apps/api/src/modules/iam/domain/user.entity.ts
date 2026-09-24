import {
  AggregateRoot,
  DomainError,
  ErrorCode,
  createEvent,
  type Json,
  type TenantId,
  type UserId,
} from '@kernel';

export type UserStatus = 'invited' | 'active' | 'disabled' | 'locked';
export type UserKind = 'staff' | 'customer' | 'system';

export interface UserProps {
  tenantId: TenantId | null;
  kind: UserKind;
  status: UserStatus;
  email: string | null;
  phone: string | null;
  fullName: string;
  passwordHash: string | null;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  mfaEnabled: boolean;
  metadata: Record<string, Json>;
  createdAt: Date;
}

/**
 * User aggregate.
 *
 * Encapsulates the account-security state machine — lockout after repeated
 * failures, disable/enable, credential changes — so those rules are enforced
 * identically whether a login, an admin action or a background job touches the
 * account. Lockout in particular is a security control; putting it in the
 * aggregate means no code path can forget to apply it.
 */
export class User extends AggregateRoot<UserId> {
  private constructor(
    id: UserId,
    private props: UserProps,
    version: number,
  ) {
    super(id);
    this._version = version;
  }

  static rehydrate(id: UserId, props: UserProps, version: number): User {
    return new User(id, props, version);
  }

  static create(
    id: UserId,
    input: {
      tenantId: TenantId | null;
      kind: UserKind;
      fullName: string;
      email?: string | null;
      phone?: string | null;
      passwordHash?: string | null;
      status?: UserStatus;
    },
  ): User {
    const user = new User(
      id,
      {
        tenantId: input.tenantId,
        kind: input.kind,
        status: input.status ?? 'active',
        email: input.email?.trim().toLowerCase() ?? null,
        phone: input.phone?.trim() ?? null,
        fullName: input.fullName.trim(),
        passwordHash: input.passwordHash ?? null,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: null,
        mfaEnabled: false,
        metadata: {},
        createdAt: new Date(),
      },
      0,
    );
    user.record(
      createEvent({
        type: 'user.created',
        aggregateType: 'user',
        aggregateId: id,
        tenantId: input.tenantId ?? undefined,
        payload: { kind: input.kind },
      }),
    );
    return user;
  }

  /** Called by the auth service after a verified credential check. */
  recordSuccessfulLogin(): void {
    this.props.failedLogins = 0;
    this.props.lockedUntil = null;
    this.props.lastLoginAt = new Date();
  }

  /**
   * Register a failed attempt and lock the account after a threshold. Returns
   * whether the account is now locked. Exponential-ish backoff via lock window.
   */
  recordFailedLogin(maxAttempts = 5, lockMinutes = 15): boolean {
    this.props.failedLogins += 1;
    if (this.props.failedLogins >= maxAttempts) {
      this.props.status = 'locked';
      this.props.lockedUntil = new Date(Date.now() + lockMinutes * 60_000);
      return true;
    }
    return false;
  }

  assertCanAuthenticate(now: Date = new Date()): void {
    if (this.props.status === 'disabled') {
      throw new DomainError(ErrorCode.AUTH_ACCOUNT_LOCKED, 'This account is disabled');
    }
    if (this.props.status === 'locked' && this.props.lockedUntil && this.props.lockedUntil > now) {
      throw new DomainError(
        ErrorCode.AUTH_ACCOUNT_LOCKED,
        'Account is temporarily locked; try again later',
      );
    }
    // A lock that has expired auto-unlocks on the next attempt.
    if (this.props.status === 'locked' && this.props.lockedUntil && this.props.lockedUntil <= now) {
      this.props.status = 'active';
      this.props.failedLogins = 0;
      this.props.lockedUntil = null;
    }
  }

  setPassword(hash: string): void {
    this.props.passwordHash = hash;
    this.record(
      createEvent({
        type: 'user.password_changed',
        aggregateType: 'user',
        aggregateId: this.id,
        tenantId: this.props.tenantId ?? undefined,
        payload: {},
      }),
    );
  }

  disable(): void {
    this.props.status = 'disabled';
  }

  /** Mark an invited/registered account as active (e.g. after OTP verification). */
  activate(): void {
    this.props.status = 'active';
  }
  enable(): void {
    this.props.status = 'active';
    this.props.failedLogins = 0;
    this.props.lockedUntil = null;
  }
  updateProfile(
    patch: Partial<Pick<UserProps, 'fullName' | 'email' | 'phone' | 'metadata'>>,
  ): void {
    Object.assign(this.props, patch);
  }

  get status(): UserStatus {
    return this.props.status;
  }
  get passwordHash(): string | null {
    return this.props.passwordHash;
  }
  get tenantId(): TenantId | null {
    return this.props.tenantId;
  }
  get kind(): UserKind {
    return this.props.kind;
  }
  get email(): string | null {
    return this.props.email;
  }
  snapshot(): Readonly<UserProps> {
    return this.props;
  }
}
