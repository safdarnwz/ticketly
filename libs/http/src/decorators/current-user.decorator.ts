import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import { getContext, type TenantId, type UserId } from '@kernel';

export interface AuthPrincipal {
  userId: UserId | null;
  tenantId: TenantId | null;
  actorType: 'user' | 'api_key' | 'channel_partner' | 'system' | 'anonymous';
  permissions: ReadonlySet<string>;
  roles: string[];
}

/**
 * `@CurrentUser()` — inject the authenticated principal into a handler.
 *
 * Reads from the ambient request context (populated by the auth guard) rather
 * than re-parsing the request, so it is consistent with what every other layer
 * sees and works identically in background jobs.
 */
export const CurrentUser = createParamDecorator((_data: unknown, _ctx: ExecutionContext): AuthPrincipal => {
  const context = getContext();
  return {
    userId: (context?.userId ?? null) as UserId | null,
    tenantId: (context?.tenantId ?? null) as TenantId | null,
    actorType: context?.actorType ?? 'anonymous',
    permissions: context?.permissions ?? new Set(),
    roles: (context?.extra?.roles as string[]) ?? [],
  };
});

/** `@CurrentTenant()` — inject the resolved tenant id (throws if absent upstream). */
export const CurrentTenant = createParamDecorator((_data: unknown, _ctx: ExecutionContext): TenantId | null => {
  return (getContext()?.tenantId ?? null) as TenantId | null;
});
