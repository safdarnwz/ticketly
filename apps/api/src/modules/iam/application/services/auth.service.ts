import { Injectable } from '@nestjs/common';

import { AppConfig } from '@config';
import { UnitOfWork } from '@database';
import {
  AppError,
  createContext,
  ErrorCode,
  getTenantId,
  newId,
  runWithContext,
  UnauthenticatedError,
  type TenantId,
  type UserId,
  type SessionId,
} from '@kernel';
import { Logger, Metrics } from '@observability';
import { OtpService, PasswordHasher, TokenService } from '@security';

import { AuditService } from './audit.service';
import { SecurityAlertService } from './security-alert.service';
import {
  isIpAllowed,
  isPasswordExpired,
  PlatformPoliciesService,
} from '../../../platform-settings';
import { User } from '../../domain/user.entity';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { UserRepository } from '../../infrastructure/persistence/user.repository';
import { SessionRepository } from '../../infrastructure/persistence/session.repository';
import { OtpChallengeRepository } from '../../infrastructure/persistence/otp-challenge.repository';
import { OtpProvider } from '../../infrastructure/otp/otp-provider';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  tokenType: 'Bearer';
}

/**
 * ============================================================================
 *  Authentication service — login, OTP, refresh, logout
 * ============================================================================
 *
 * Security decisions worth calling out:
 *
 *  - **Uniform failure.** Wrong email and wrong password both return the same
 *    `AUTH.INVALID_CREDENTIALS` after doing the same amount of work, so an
 *    attacker cannot enumerate which emails exist by timing or message.
 *  - **Lockout in the aggregate.** Failed attempts are counted and the account
 *    locks after a threshold — enforced in the `User` aggregate so it cannot be
 *    skipped.
 *  - **Rotating refresh tokens.** Each refresh issues a NEW refresh token and
 *    revokes the old session; presenting an already-rotated token is treated as
 *    theft and kills the user's whole session chain.
 *  - **Transparent hash upgrade.** If the stored password hash used weaker
 *    parameters than we now require, we re-hash on successful login.
 */
@Injectable()
export class AuthService {
  private readonly log: Logger;

  constructor(
    private readonly users: UserRepository,
    private readonly roles: RoleRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    logger: Logger,
    private readonly metrics: Metrics,
    private readonly otpProvider: OtpProvider,
    private readonly otpChallenges: OtpChallengeRepository,
    private readonly policies: PlatformPoliciesService,
    private readonly alerts: SecurityAlertService,
  ) {
    this.log = logger.forContext('AuthService');
  }

  /* ── Unified login + customer self-registration (ticketly.com guest flow) ───*/

  /** Is there already an account for this email/phone? (drives the pay-time login vs register fork.) */
  /**
   * @remarks An 'invited' (never-completed-OTP-verification) account is
   * treated as NOT registered — the same reasoning as registerCustomer's
   * reuse logic: someone who abandoned registration mid-way shouldn't be
   * routed to a login screen (where they'd need to already know a
   * password they may not remember setting) when what they actually need
   * is to pick registration back up. A genuinely-verified account still
   * correctly reports as registered.
   */
  async checkIdentity(
    identifier: string,
  ): Promise<{ registered: boolean; channel: 'email' | 'phone' }> {
    const isEmail = identifier.includes('@');
    const user = isEmail
      ? await this.users.findByEmailGlobal(identifier)
      : await this.users.findByPhoneGlobal(identifier.trim());
    return {
      registered: Boolean(user) && user!.status !== 'invited',
      channel: isEmail ? 'email' : 'phone',
    };
  }

  /** Login with EITHER an email or a mobile number, plus password. */
  async passwordLogin(input: {
    identifier: string;
    password: string;
    tenantId: TenantId | null;
    /** Which of Ticketly's three hosts the request came in on — enforces
     *  that a login can only succeed on the host that account belongs to. */
    loginSurface?: 'customer' | 'superAdmin' | 'tenantAdmin' | 'unresolved';
    userAgent?: string;
    ip?: string;
  }): Promise<AuthTokens> {
    const isEmail = input.identifier.includes('@');
    const user = isEmail
      ? await this.users.findByEmailGlobal(input.identifier)
      : await this.users.findByPhoneGlobal(input.identifier.trim());
    if (!user || !user.passwordHash) {
      await this.hasher.verify(input.password, DUMMY_HASH).catch(() => false);
      throw new UnauthenticatedError(ErrorCode.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid credentials',
      });
    }

    // Host-bound login: a tenant's staff can only sign in at their OWN
    // console URL (app.<slug>.ticketly.com); the platform console
    // (app.ticketly.com) only authenticates tenant-less platform-role
    // accounts; the customer site (www.ticketly.com) only authenticates
    // tenant-less customer accounts. Fails with the SAME uniform message as
    // a wrong password, so a wrong-host attempt can't be used to probe which
    // accounts exist or which tenant they belong to.
    if (
      input.loginSurface &&
      !(await this.isAllowedOnSurface(user, input.loginSurface, input.tenantId))
    ) {
      await this.hasher.verify(input.password, DUMMY_HASH).catch(() => false);
      throw new UnauthenticatedError(ErrorCode.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid credentials',
      });
    }

    // Password verified BEFORE the account-status check, on purpose: this
    // is what stops an attacker from being able to fish for which phone
    // numbers/emails are registered by watching for a DIFFERENT error
    // ("account disabled"/"account locked") vs the uniform "Invalid
    // credentials" every other failure path in this method already goes
    // out of its way to return. Only someone who ALREADY has the correct
    // password ever learns that an account exists and is locked/disabled
    // — at that point they're either the legitimate owner (who benefits
    // from the clearer message) or already possess the credential, so
    // there's nothing left to enumerate.
    const ok = await this.hasher.verify(input.password, user.passwordHash);
    if (!ok) {
      const locked = user.recordFailedLogin();
      await this.uow.run({ name: 'auth.recordFailure', tenantId: user.tenantId }, async () => {
        await this.users.update(user, user.version);
      });
      await this.alerts.onLoginFailed(user, input.ip);
      if (locked)
        throw new AppError(ErrorCode.AUTH_ACCOUNT_LOCKED, 423, {
          message: 'Account locked after too many attempts',
        });
      throw new UnauthenticatedError(ErrorCode.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid credentials',
      });
    }
    user.assertCanAuthenticate();
    await this.assertLoginPolicies(user, input.ip);
    user.recordSuccessfulLogin();
    if (this.hasher.needsRehash(user.passwordHash))
      user.setPassword(await this.hasher.hash(input.password));
    return this.issueForUser(user, input.userAgent, input.ip, 'password');
  }

  /** Is `user` allowed to authenticate on the host it just presented itself at? */
  private async isAllowedOnSurface(
    user: User,
    surface: 'customer' | 'superAdmin' | 'tenantAdmin' | 'unresolved',
    resolvedTenantId: TenantId | null,
  ): Promise<boolean> {
    if (surface === 'tenantAdmin') {
      // app.<slug>.ticketly.com — the slug must have resolved to a real
      // tenant, and the user must belong to EXACTLY that tenant. This is
      // what stops an operator's staff logging in on another operator's
      // (or their own operator's application-pending) URL.
      return resolvedTenantId !== null && user.tenantId === resolvedTenantId;
    }
    if (surface === 'customer') {
      // www.ticketly.com — only central, tenant-less customer accounts.
      return user.tenantId === null && user.kind === 'customer';
    }
    if (surface === 'superAdmin') {
      // app.ticketly.com — only tenant-less platform staff.
      if (user.tenantId !== null || user.kind !== 'staff') return false;
      const { roles } = await this.roles.resolvePermissions(user.id);
      return roles.includes('super_admin') || roles.includes('platform_admin');
    }
    // `unresolved` — a Host we don't recognise as one of the three canonical
    // domains (e.g. a not-yet-verified custom domain). Don't add a NEW
    // restriction here; the pre-existing behaviour (tenant, if any, comes
    // from the JWT) still applies.
    return true;
  }

  /**
   * Register a customer (central account, no tenant) with a password, and send
   * an Email OTP to verify. The account is created `invited` and activated on
   * verification. Idempotency-adjacent: a duplicate email/phone is rejected.
   */
  /**
   * @remarks If a PREVIOUS registration attempt for this exact email+mobile
   * exists but was never verified (status still 'invited' — the OTP email
   * bounced, arrived late, or the person simply closed the tab before
   * entering it), this REUSES that same account row rather than rejecting
   * the attempt as "already registered". A real person abandoning
   * registration mid-way and coming back later to try again is a common,
   * ordinary case — not an edge case to lock them out of permanently. Their
   * password/name are updated to whatever they just submitted (the most
   * RECENT attempt is the one that should win), and a fresh OTP is issued.
   * Once a registration is actually VERIFIED (status becomes active), this
   * path never applies again — a genuinely-registered email/mobile still
   * correctly blocks a second registration.
   */
  async registerCustomer(input: {
    fullName: string;
    email: string;
    mobile: string;
    password: string;
  }): Promise<{ challengeId: string; email: string }> {
    const existingByEmail = await this.users.findByEmailGlobal(input.email);
    const existingByPhone = await this.users.findByPhoneGlobal(input.mobile.trim());
    const existing = existingByEmail ?? existingByPhone;

    if (existing && existing.status !== 'invited') {
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message: 'An account with this email or mobile already exists',
      });
    }
    // Both matched but as TWO DIFFERENT still-unverified rows (e.g. someone
    // typo'd their email on attempt 1, retried with a different email but
    // the SAME mobile on attempt 2) — reusing either one silently would
    // orphan the other. Rare, but not a case to guess at; ask them to
    // pick one identity to continue with rather than silently merging.
    if (existingByEmail && existingByPhone && existingByEmail.id !== existingByPhone.id) {
      throw new AppError(ErrorCode.COMMON_CONFLICT, 409, {
        message:
          'This email and mobile are tied to two different unfinished registrations — please use the email or mobile from whichever attempt you want to continue.',
      });
    }

    await this.policies.assertPasswordAcceptable(input.password);
    const passwordHash = await this.hasher.hash(input.password);
    let user: User;
    if (existing) {
      existing.updateProfile({
        fullName: input.fullName,
        email: input.email,
        phone: input.mobile.trim(),
      });
      existing.setPassword(passwordHash);
      user = existing;
      await this.uow.run({ name: 'auth.registerCustomer.reuse' }, async () => {
        await this.users.update(user, user.version);
      });
    } else {
      user = User.create(newId() as UserId, {
        tenantId: null,
        kind: 'customer',
        fullName: input.fullName,
        email: input.email,
        phone: input.mobile.trim(),
        passwordHash,
        status: 'invited',
      });
      await this.uow.run({ name: 'auth.registerCustomer' }, async () => {
        await this.users.insert(user);
      });
    }
    const { challengeId } = await this.issueOtp({
      identity: input.email,
      tenantId: null,
      purpose: 'register',
      name: input.fullName,
    });
    return { challengeId, email: input.email };
  }

  /** Verify the registration Email OTP → activate the account and auto-login. */
  async verifyRegistration(input: {
    email: string;
    code: string;
    userAgent?: string;
    ip?: string;
  }): Promise<AuthTokens> {
    const user = await this.uow.run<User | AppError>(
      { name: 'auth.verifyRegistration' },
      async () => {
        const rejected = await this.consumeOtp(null, input.email, 'register', input.code);
        if (rejected) return rejected;

        const found = await this.users.findByEmailGlobal(input.email);
        if (!found)
          throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
            message: 'Registration not found',
          });
        found.activate();
        found.recordSuccessfulLogin();
        await this.users.update(found, found.version);
        return found;
      },
    );
    if (user instanceof AppError) throw user;
    return this.issueForUser(user, input.userAgent, input.ip, 'register');
  }

  /** Generate, store and DELIVER an OTP over the configured provider (email today). */
  private async issueOtp(input: {
    identity: string;
    tenantId: TenantId | null;
    purpose: string;
    name?: string;
  }): Promise<{ challengeId: string; expiresInSeconds: number }> {
    const code = this.otp.generate(6);
    const codeHash = this.otp.hashOtp(code, input.identity);
    const ttl = 300;
    const challengeId = newId();
    await this.otpChallenges.insert({
      id: challengeId,
      tenantId: input.tenantId,
      identity: input.identity,
      purpose: input.purpose,
      codeHash,
      ttlSeconds: ttl,
    });
    try {
      await this.otpProvider.deliver(input.identity, code, {
        name: input.name,
        purpose: input.purpose,
      });
    } catch (e) {
      this.log.error({ err: e, identity: input.identity }, 'OTP delivery failed');
    }
    if (!this.config.isProduction)
      this.log.info({ identity: input.identity, code }, 'OTP (dev only)');
    return { challengeId, expiresInSeconds: ttl };
  }

  /**
   * Check `code` against the newest active challenge and consume it. Runs
   * inside the caller's unit of work. A wrong code is RETURNED, not thrown: the
   * caller commits (so the failed attempt is counted — a throw would roll it
   * back and make the attempt limit useless) and throws after the transaction.
   */
  private async consumeOtp(
    tenantId: TenantId | null,
    identity: string,
    purpose: string,
    code: string,
  ): Promise<AppError | null> {
    const challenge = await this.otpChallenges.lockLatestActive(tenantId, identity, purpose);
    if (!challenge)
      throw new AppError(ErrorCode.AUTH_OTP_INVALID, 401, {
        message: 'No active code; request a new one',
      });
    if (challenge.attempts >= challenge.maxAttempts)
      throw new AppError(ErrorCode.AUTH_OTP_INVALID, 429, {
        message: 'Too many attempts; request a new code',
      });
    if (!this.otp.verify(code, identity, challenge.codeHash)) {
      await this.otpChallenges.recordFailedAttempt(challenge.id);
      return new AppError(ErrorCode.AUTH_OTP_INVALID, 401, { message: 'Incorrect code' });
    }
    await this.otpChallenges.consume(challenge.id);
    return null;
  }

  /** Email + password login (operator staff). */
  async loginWithPassword(input: {
    email: string;
    password: string;
    tenantId: TenantId | null;
    userAgent?: string;
    ip?: string;
  }): Promise<AuthTokens> {
    const user = await this.users.findByEmail(input.email);

    // Constant-ish work whether or not the user exists: always run a hash verify.
    if (!user || !user.passwordHash) {
      await this.hasher.verify(input.password, DUMMY_HASH).catch(() => false);
      throw new UnauthenticatedError(ErrorCode.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid email or password',
      });
    }

    user.assertCanAuthenticate();

    const ok = await this.hasher.verify(input.password, user.passwordHash);
    if (!ok) {
      const locked = user.recordFailedLogin();
      await this.uow.run({ name: 'auth.recordFailure' }, async () => {
        await this.users.update(user, user.version);
      });
      await this.alerts.onLoginFailed(user, input.ip);
      if (locked) {
        this.metrics.jobRuns.inc({ job: 'auth.login', outcome: 'locked' });
        throw new AppError(ErrorCode.AUTH_ACCOUNT_LOCKED, 423, {
          message: 'Account locked after too many attempts',
        });
      }
      throw new UnauthenticatedError(ErrorCode.AUTH_INVALID_CREDENTIALS, {
        message: 'Invalid email or password',
      });
    }

    await this.assertLoginPolicies(user, input.ip);

    // Success: reset counters, upgrade hash if needed.
    user.recordSuccessfulLogin();
    if (this.hasher.needsRehash(user.passwordHash)) {
      user.setPassword(await this.hasher.hash(input.password));
    }

    return this.issueForUser(user, input.userAgent, input.ip, 'password');
  }

  /** Step 1 of OTP login: create and (via events) dispatch a code. */
  async requestOtp(input: {
    identity: string;
    tenantId: TenantId | null;
    purpose?: string;
  }): Promise<{ challengeId: string; expiresInSeconds: number }> {
    // Per-IDENTITY cooldown, separate from the controller's per-IP
    // rate-limit — an attacker with access to multiple IPs (trivial via
    // any proxy/VPN rotation) would otherwise be able to request
    // unlimited OTPs for one victim's phone number, which is both SMS-
    // bombing harassment for them and a real per-message cost the
    // operator pays for every single one. One request per identity per
    // 45 seconds is enough for a genuine "didn't arrive, resend" case
    // without opening this door.
    if ((await this.otpChallenges.countSentSince(input.identity, 45, input.tenantId)) > 0) {
      throw new AppError(ErrorCode.COMMON_RATE_LIMITED, 429, {
        message: 'Please wait before requesting another code',
        retryable: true,
      });
    }
    return this.issueOtp({
      identity: input.identity,
      tenantId: input.tenantId,
      purpose: input.purpose ?? 'login',
    });
  }

  /** Step 2 of OTP login: verify the code, create the customer if new, issue tokens. */
  async verifyOtp(input: {
    identity: string;
    code: string;
    tenantId: TenantId | null;
    fullName?: string;
    userAgent?: string;
    ip?: string;
  }): Promise<AuthTokens> {
    const user = await this.uow.run<User | AppError>(
      { name: 'auth.verifyOtp', tenantId: input.tenantId },
      async () => {
        const rejected = await this.consumeOtp(input.tenantId, input.identity, 'login', input.code);
        if (rejected) return rejected;

        // Find-or-create the customer by phone/email.
        const isEmail = input.identity.includes('@');
        let found = isEmail
          ? await this.users.findByEmail(input.identity)
          : await this.users.findByPhone(input.identity);
        if (!found) {
          found = User.create(
            newId() as UserId,
            {
              tenantId: input.tenantId,
              kind: 'customer',
              fullName: input.fullName?.trim() || 'Customer',
              email: isEmail ? input.identity : null,
              phone: isEmail ? null : input.identity,
            } as never,
          );
          await this.users.insert(found);
          // Customers get no roles by default; booking permission is granted to
          // the anonymous/customer principal by the guard policy (Part 7).
        }
        found.recordSuccessfulLogin();
        await this.users.update(found, found.version);
        return found;
      },
    );
    if (user instanceof AppError) throw user;

    return this.issueForUser(user, input.userAgent, input.ip, 'otp');
  }

  /**
   * Password reset via OTP — request an OTP with purpose='password_reset'
   * (the EXISTING requestOtp already supports arbitrary purposes, no change
   * needed there), then call this to verify it and set a new password.
   * Unlike verifyOtp (login), this does NOT find-or-create a user — a
   * password reset only makes sense for an account that already exists, and
   * silently creating one here would be a way to "verify" an OTP without a
   * real account behind it. Revokes every existing session on success — a
   * password reset is exactly the moment to force re-login everywhere,
   * including on a device an attacker may have been using.
   */
  async resetPasswordWithOtp(input: {
    identity: string;
    code: string;
    newPassword: string;
    tenantId: TenantId | null;
  }): Promise<void> {
    // Checked before the OTP is consumed, so a rejected password doesn't burn the code.
    await this.policies.assertPasswordAcceptable(input.newPassword);
    const userId = await this.uow.run<UserId | AppError>(
      { name: 'auth.resetPassword', tenantId: input.tenantId },
      async () => {
        const rejected = await this.consumeOtp(
          input.tenantId,
          input.identity,
          'password_reset',
          input.code,
        );
        if (rejected) return rejected;

        const isEmail = input.identity.includes('@');
        const user = isEmail
          ? await this.users.findByEmail(input.identity)
          : await this.users.findByPhone(input.identity);
        if (!user)
          throw new AppError(ErrorCode.COMMON_NOT_FOUND, 404, {
            message: 'No account found for this email/phone',
          });

        user.setPassword(await this.hasher.hash(input.newPassword));
        await this.users.update(user, user.version);
        return user.id;
      },
    );
    if (userId instanceof AppError) throw userId;

    await this.sessions.revokeAllForUser(userId, 'password-reset');
  }

  /** Rotate a refresh token → new access + refresh, revoking the old session. */
  async refresh(
    refreshToken: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<AuthTokens> {
    const claims = this.tokens.verifyRefresh(refreshToken);
    const session = await this.sessions.findActiveByToken(refreshToken);

    if (!session) {
      // Valid signature but the session is gone → token was already rotated or
      // revoked. Treat as compromise: nuke every session for the user.
      await this.sessions.revokeAllForUser(claims.sub, 'refresh-reuse-detected');
      throw new UnauthenticatedError(ErrorCode.AUTH_SESSION_REVOKED, {
        message: 'Session is no longer valid; please sign in again',
      });
    }

    return runWithContext(
      createContext({
        tenantId: session.tenantId ?? undefined,
        userId: session.userId,
        actorType: 'user',
      }),
      async () => {
        const user = await this.users.findById(session.userId);
        if (!user) throw new UnauthenticatedError(ErrorCode.AUTH_SESSION_REVOKED);
        user.assertCanAuthenticate();

        const tokens = await this.uow.run<AuthTokens>(
          { name: 'auth.refresh', tenantId: session.tenantId },
          async () => {
            await this.sessions.revoke(session.id, 'rotated');
            return this.mintTokens(user, session.tenantId, meta, session.id);
          },
        );
        return tokens;
      },
    );
  }

  /**
   * A signed-in user changes their own password (478). The current password
   * must be right; every other session ends, this one stays signed in.
   */
  async changePassword(input: {
    userId: UserId;
    currentPassword: string;
    newPassword: string;
    sessionId: string | null;
  }): Promise<void> {
    if (input.currentPassword === input.newPassword)
      throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
        message: 'The new password must be different from the current one',
      });
    await this.policies.assertPasswordAcceptable(input.newPassword);
    const hash = await this.hasher.hash(input.newPassword);
    await this.uow.run(
      { name: 'auth.changePassword', tenantId: getTenantId() ?? null },
      async () => {
        const user = await this.users.findById(input.userId);
        if (!user) throw new UnauthenticatedError(ErrorCode.AUTH_SESSION_REVOKED);
        if (
          !user.passwordHash ||
          !(await this.hasher.verify(input.currentPassword, user.passwordHash))
        )
          throw new AppError(ErrorCode.COMMON_VALIDATION, 422, {
            message: 'Your current password is not right',
          });
        user.setPassword(hash);
        await this.users.update(user, user.version);
      },
    );
    await this.sessions.revokeOthers(input.userId, input.sessionId, 'password-changed');
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findActiveByToken(refreshToken);
    if (session) await this.sessions.revoke(session.id, 'logout');
  }

  async logoutAll(userId: UserId): Promise<number> {
    return this.sessions.revokeAllForUser(userId, 'logout-all');
  }

  /* ── internals ────────────────────────────────────────────────────────*/

  /**
   * Checks that run only once the password is known to be correct, so they
   * can't be used to probe which accounts exist:
   *  - platform staff may only sign in from the admin IP allowlist (#26);
   *  - an expired password must be reset first (#29);
   *  - a platform admin signing in from a new IP raises an alert (#54).
   */
  private async assertLoginPolicies(user: User, ip: string | undefined): Promise<void> {
    const isPlatformStaff = user.tenantId === null && user.kind === 'staff';
    if (isPlatformStaff && !isIpAllowed(await this.policies.adminIpAllowlist(), ip)) {
      await this.audit.record({
        action: 'security.admin_ip_blocked',
        resourceType: 'user',
        resourceId: user.id,
        actorId: user.id,
        changes: { ip: ip ?? null },
      });
      throw new AppError(ErrorCode.AUTH_IP_NOT_ALLOWED, 403, {
        message: 'Platform admin sign-in is not allowed from this network',
      });
    }
    const policy = await this.policies.passwordPolicy();
    if (isPasswordExpired(policy, await this.users.passwordChangedAt(user.id, user.tenantId))) {
      throw new AppError(ErrorCode.AUTH_PASSWORD_EXPIRED, 403, {
        message: `Your password is older than ${policy.expiryDays} days — reset it to continue`,
        details: {
          reset:
            'POST /v1/auth/otp/request {purpose: "password_reset"} then POST /v1/auth/password-reset/confirm',
        },
      });
    }
    if (isPlatformStaff) await this.alerts.onPlatformAdminLogin(user, ip);
  }

  private async issueForUser(
    user: User,
    userAgent: string | undefined,
    ip: string | undefined,
    method: string,
  ): Promise<AuthTokens> {
    const tenantId = user.tenantId;
    const tokens = await this.uow.run<AuthTokens>({ name: 'auth.issue', tenantId }, async () => {
      // Persist the login-state changes made on the aggregate.
      await this.users.update(user, user.version);
      return this.mintTokens(user, tenantId, { userAgent, ip }, null);
    });
    await this.audit.record({
      action: 'user.logged_in',
      resourceType: 'user',
      resourceId: user.id,
      tenantId,
      actorId: user.id,
      changes: { method },
    });
    this.metrics.jobRuns.inc({ job: 'auth.login', outcome: 'ok' });
    return tokens;
  }

  /** Create the session row and sign both tokens. Runs inside a UoW. */
  private async mintTokens(
    user: User,
    tenantId: TenantId | null,
    meta: { userAgent?: string; ip?: string },
    parentId: SessionId | null,
  ): Promise<AuthTokens> {
    const { permissions, roles } = await this.roles.resolvePermissions(user.id);
    const sessionId = newId() as SessionId;

    const refresh = this.tokens.signRefresh({
      sub: user.id,
      tid: tenantId,
      sid: sessionId,
      jti: newId(),
    });
    const realSessionId = await this.sessions.create({
      userId: user.id,
      tenantId,
      refreshToken: refresh.token,
      expiresAt: refresh.expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
      parentId,
    });

    const access = this.tokens.signAccess({
      sub: user.id,
      tid: tenantId,
      sid: realSessionId,
      jti: newId(),
      ph: permissionsHash(permissions),
      roles,
    });

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt: refresh.expiresAt,
      tokenType: 'Bearer',
    };
  }
}

// A fixed hash to compare against for non-existent users, so the timing of a
// missing-user path matches the wrong-password path.
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function permissionsHash(permissions: string[]): string {
  return createHashHex([...permissions].sort().join(','));
}
function createHashHex(value: string): string {
  // Cheap non-crypto hash just to detect stale permission sets on refresh.
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
