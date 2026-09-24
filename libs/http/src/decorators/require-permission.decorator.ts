import { SetMetadata } from '@nestjs/common';

import type { PermissionValue } from '@contracts';

export const REQUIRE_PERMISSION_KEY = 'iam:permissions';
export const REQUIRE_PERMISSION_MODE = 'iam:permissions:mode';

/**
 * Guard a handler behind one or more permissions.
 *
 *   @RequirePermission('booking:cancel')
 *   @RequirePermission(['report:read', 'report:export'], 'any')
 *
 * Default mode is 'all' (the principal must hold every listed permission).
 * The permission strings are the typed catalogue in @contracts, so a typo is a
 * compile error rather than a silently-unenforced route.
 */
export function RequirePermission(
  permissions: PermissionValue | PermissionValue[],
  mode: 'all' | 'any' = 'all',
): MethodDecorator & ClassDecorator {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(REQUIRE_PERMISSION_KEY, list)(
      target,
      key as string,
      descriptor as PropertyDescriptor,
    );
    SetMetadata(REQUIRE_PERMISSION_MODE, mode)(
      target,
      key as string,
      descriptor as PropertyDescriptor,
    );
  };
}
