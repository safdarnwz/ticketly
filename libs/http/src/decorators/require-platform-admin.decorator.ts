import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PLATFORM_ADMIN_KEY = 'iam:platformAdmin';

/**
 * Marks a route as platform-admin-ONLY: it must be called by a genuinely
 * tenant-less principal (`ctx.tenantId` is null), never by a tenant-scoped
 * token — even one holding the tenant's own `*` wildcard (an operator
 * `owner`). Combine with `@RequirePermission(Permission.ALL)` for the
 * permission check; this decorator adds the "and it's not just any `*`,
 * it's the PLATFORM's `*`" check, enforced by `PermissionGuard`.
 *
 * Without this, a tenant `owner` (who legitimately holds `*` within their
 * own tenant) could reach a route meant only for Ticketly's own staff.
 */
export const RequirePlatformAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PLATFORM_ADMIN_KEY, true);
