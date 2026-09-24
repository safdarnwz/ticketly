import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'http:idempotent';

/**
 * Marks a handler as requiring an `Idempotency-Key` header and enables
 * replay-safe execution. Mandatory on every endpoint that creates or moves
 * money, or that consumes seat inventory.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);
