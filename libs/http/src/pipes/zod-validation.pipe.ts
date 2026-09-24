import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema, type ZodTypeDef } from 'zod';

import { ValidationError, type FieldIssue } from '@kernel';

/**
 * ============================================================================
 *  Validation with zod (not class-validator)
 * ============================================================================
 *
 * WHY ZOD:
 *  - **One source of truth.** `z.infer<typeof schema>` gives the TypeScript type
 *    for free. With class-validator the class and the decorators can drift, and
 *    they routinely do.
 *  - **No reflect-metadata at runtime per property**, no decorator ordering
 *    surprises, and roughly 3-5x faster on nested payloads — which matters on a
 *    booking request carrying 40 passengers.
 *  - **Transforms are part of validation.** `z.coerce.number()`,
 *    `.transform(localDate)` mean the handler receives *domain* values
 *    (`LocalDate`, `Money`), not strings it has to re-parse.
 *  - **Composable.** Search filters, list filters and partner-API variants share
 *    schema fragments via `.extend()` / `.pick()`.
 *
 * Errors become a `ValidationError` with a stable `issues[]` array so clients
 * can highlight the exact field.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema<unknown, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw toValidationError(result.error);
  }
}

/** Factory used in controllers: `@Body(zodBody(CreateBookingSchema))`. */
export function zodBody<T>(schema: ZodSchema<T, ZodTypeDef, unknown>): ZodValidationPipe {
  return new ZodValidationPipe(schema as ZodSchema<unknown, ZodTypeDef, unknown>);
}

export function toValidationError(error: ZodError): ValidationError {
  const issues: FieldIssue[] = error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.map(segment).join('') : '(root)',
    rule: issue.code,
    message: issue.message,
  }));
  return new ValidationError(issues);
}

function segment(part: string | number, index: number): string {
  if (typeof part === 'number') return `[${part}]`;
  return index === 0 ? part : `.${part}`;
}

/**
 * Parse-or-throw outside the Nest pipeline (jobs, webhook payloads, CSV import).
 * Keeps validation failures uniform regardless of entry point.
 */
export function parseOrThrow<T>(schema: ZodSchema<T, ZodTypeDef, unknown>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw toValidationError(result.error);
  return result.data;
}
