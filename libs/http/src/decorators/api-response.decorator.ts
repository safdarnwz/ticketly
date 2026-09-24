import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/**
 * Documents the RFC 9457 problem responses every endpoint can return, so the
 * generated OpenAPI spec (and therefore every generated client SDK) knows the
 * error shape without each controller repeating it.
 */
export const ApiStandardErrors = (...extra: number[]): MethodDecorator & ClassDecorator => {
  const statuses = [...new Set([400, 401, 403, 404, 409, 422, 429, 500, ...extra])].sort(
    (a, b) => a - b,
  );
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: DESCRIPTIONS[status] ?? 'Error',
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/ProblemDetails' },
          },
        },
      }),
    ),
  );
};

const DESCRIPTIONS: Record<number, string> = {
  400: 'Malformed request or failed validation',
  401: 'Missing or invalid credentials',
  403: 'Authenticated but not permitted',
  404: 'Resource does not exist (or is not visible to this tenant)',
  409: 'Conflicts with current state; may be retryable',
  422: 'A domain rule rejected the request',
  429: 'Rate limit exceeded — see the RateLimit-* headers',
  500: 'Unexpected server error',
  502: 'Upstream dependency failed',
  503: 'Temporarily unavailable',
  504: 'Request exceeded its time budget',
};
