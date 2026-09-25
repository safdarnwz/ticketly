import { AppError, ErrorCode, getContext } from '@kernel';

import { permissionGrantProblems } from '../../domain/permission-grant';

/** 403 unless the signed-in operator user may hand out every one of these permissions. */
export function assertGrantable(permissions: readonly string[]): void {
  const problems = permissionGrantProblems(
    permissions,
    getContext()?.permissions ?? new Set<string>(),
  );
  if (problems.length > 0)
    throw new AppError(ErrorCode.COMMON_FORBIDDEN, 403, {
      message: `Cannot grant: ${problems.join('; ')}`,
      details: { problems },
    });
}
