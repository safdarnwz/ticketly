import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { PermissionValue } from '@contracts';
import { ForbiddenError, getContext } from '@kernel';

import { REQUIRE_PERMISSION_KEY, REQUIRE_PERMISSION_MODE, REQUIRE_PLATFORM_ADMIN_KEY } from '@http';

/**
 * Enforces `@RequirePermission(...)` and `@RequirePlatformAdmin()`.
 *
 * Runs AFTER the auth guard (order is set in the module), so the principal's
 * permission set is already on the context. The wildcard `*` (platform admin /
 * tenant owner) satisfies any `@RequirePermission` requirement. Evaluation is a
 * set lookup — no DB hit — because the permissions were resolved once at
 * authentication time.
 *
 * `@RequirePlatformAdmin()` is a SEPARATE, additional gate: `*` is held by
 * BOTH the platform super-admin AND every tenant's own `owner` role, so a
 * route meant only for Ticketly's own staff (CMS, fraud review, i18n/FX
 * rates, privacy, the console's own theme — see migration 0018) must also
 * check that `ctx.tenantId` is null, or a tenant owner could reach it too.
 *
 * ABAC hook: attribute conditions (e.g. "manager limited to routes X,Y") are
 * evaluated by feature-level policies against the resource being accessed; this
 * guard handles the coarse RBAC gate that every protected route needs.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresPlatformAdmin = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_PLATFORM_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiresPlatformAdmin && getContext()?.tenantId) {
      throw new ForbiddenError({
        message: 'This action requires a platform (non-tenant) principal',
      });
    }

    const required = this.reflector.getAllAndOverride<PermissionValue[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const mode =
      this.reflector.getAllAndOverride<'all' | 'any'>(REQUIRE_PERMISSION_MODE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'all';

    const permissions = getContext()?.permissions ?? new Set<string>();
    if (permissions.has('*')) return true;

    const satisfied =
      mode === 'any'
        ? required.some((p) => permissions.has(p))
        : required.every((p) => permissions.has(p));

    if (!satisfied) {
      throw new ForbiddenError({
        message: 'You do not have permission to perform this action',
        details: { required, mode },
      });
    }
    return true;
  }
}
