import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { IS_PUBLIC_KEY } from '@http';
import { AppError, getContext, UnauthenticatedError, ErrorCode } from '@kernel';

import { ApiKeyService } from '../../application/services/api-key.service';
import { TokenService } from '@security';
import { RoleRepository } from '../../infrastructure/persistence/role.repository';
import { evaluateAccess } from '../../domain/access-policy';

/**
 * ============================================================================
 *  Global authentication guard
 * ============================================================================
 *
 * DEFAULT-DENY: every route is authenticated unless explicitly marked
 * `@Public()`. Defaulting the other way — open unless annotated — means one
 * forgotten decorator becomes a data breach, which is unacceptable for a system
 * holding passenger PII and payment records.
 *
 * Accepts two credential types and enriches the ambient request context with
 * the resolved principal + permissions:
 *  1. **Bearer JWT** (operator console, customer app). Stateless verify — no DB
 *     hit on the hot path; permissions come from the token.
 *  2. **X-Api-Key** (OTA / channel partners). Verified against the cached key
 *     store; scopes become the permission set.
 *
 * The guard MUTATES the existing context object (it does not create a new one)
 * because the request-context middleware already established it; every
 * downstream layer holds a reference to that same object.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly apiKeys: ApiKeyService,
    private readonly roles: RoleRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const ctx = getContext();
    if (!ctx) return true; // context middleware not run (e.g. some probes)

    // Try to authenticate even on public routes so `@CurrentUser()` is populated
    // when a token happens to be present, but do not REQUIRE it there.
    const apiKey = header(request, 'x-api-key');
    const authorization = header(request, 'authorization');

    try {
      if (apiKey) {
        await this.authenticateApiKey(apiKey, ctx, request.ip);
      } else if (authorization?.startsWith('Bearer ')) {
        await this.authenticateBearer(authorization.slice(7), ctx);
      } else if (!isPublic) {
        throw new UnauthenticatedError(ErrorCode.COMMON_UNAUTHENTICATED, {
          message: 'Provide a Bearer token or X-Api-Key',
        });
      }
    } catch (error) {
      if (isPublic) return true; // bad creds on a public route → treat as anonymous
      throw error;
    }

    return true;
  }

  private async authenticateBearer(
    token: string,
    ctx: NonNullable<ReturnType<typeof getContext>>,
  ): Promise<void> {
    const claims = this.tokens.verifyAccess(token);
    // Permissions are embedded in the token for speed; we re-resolve only when
    // the token predates a grant change (detected via the permission hash on
    // sensitive routes — the permission guard can force a refresh).
    ctx.userId = claims.sub;
    // A staff token is bound to its own operator, always. A tenant-less token
    // with no roles is a customer: customer accounts are central, so the
    // operator they are booking with comes from the request (X-Tenant-Id /
    // host) and is kept. A tenant-less platform-staff token never inherits one.
    const isCustomerToken = !claims.tid && (claims.roles ?? []).length === 0;
    ctx.tenantId = claims.tid ?? (isCustomerToken ? ctx.tenantId : undefined);
    ctx.actorType = 'user';
    const resolved =
      claims.roles && claims.roles.length > 0
        ? await this.roles.resolvePermissions(claims.sub)
        : {
            permissions: [],
            roles: claims.roles ?? [],
            active: true,
            accessExpiresAt: null,
            tokensValidAfter: null,
            loginWindow: null,
          };
    if (!resolved.active) {
      throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, 401, {
        message: 'This account has been disabled — please contact your administrator',
      });
    }
    const denied = evaluateAccess({
      accessExpiresAt: resolved.accessExpiresAt ? new Date(resolved.accessExpiresAt) : null,
      tokensValidAfter: resolved.tokensValidAfter ? new Date(resolved.tokensValidAfter) : null,
      tokenIssuedAtSec: (claims as { iat?: number }).iat,
      tokenIssuedAtMs: (claims as { iatMs?: number }).iatMs,
      loginWindow: resolved.loginWindow,
    });
    if (denied === 'expired')
      throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, 401, {
        message: 'Your access period has ended — contact your administrator',
      });
    if (denied === 'session_revoked')
      throw new AppError(ErrorCode.AUTH_SESSION_REVOKED, 401, {
        message: 'You were signed out by an administrator — please sign in again',
      });
    if (denied === 'outside_login_window')
      throw new AppError(ErrorCode.AUTH_TOKEN_INVALID, 403, {
        message: 'Sign-in is not allowed at this time for your account',
      });
    (ctx.permissions as Set<string>) = new Set(resolved.permissions);
    (ctx.extra as Record<string, unknown>).roles = resolved.roles;
    (ctx.extra as Record<string, unknown>).sessionId = claims.sid;
  }

  private async authenticateApiKey(
    key: string,
    ctx: NonNullable<ReturnType<typeof getContext>>,
    ip: string,
  ): Promise<void> {
    const record = await this.apiKeys.verify(key, ip);
    if (!record) {
      throw new UnauthenticatedError(ErrorCode.AUTH_TOKEN_INVALID, { message: 'Invalid API key' });
    }
    ctx.tenantId = record.tenantId;
    ctx.actorType = 'channel_partner';
    (ctx.permissions as Set<string>) = new Set(record.scopes);
    (ctx.extra as Record<string, unknown>).apiKeyId = record.id;
    (ctx.extra as Record<string, unknown>).partnerName = record.name;
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
